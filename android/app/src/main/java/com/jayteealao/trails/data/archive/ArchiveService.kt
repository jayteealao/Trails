package com.jayteealao.trails.data.archive

import android.app.Application
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import com.google.android.gms.auth.GoogleAuthUtil
import com.google.android.gms.auth.UserRecoverableAuthException
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.ListenerRegistration
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.services.firestore.FirestoreBackupService
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import timber.log.Timber
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.URLEncoder
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream
import javax.inject.Inject
import javax.inject.Singleton

data class ArchiveStatus(val status: String, val gcsPath: String?)

data class WargMetadata(
    val title: String?,
    val excerpt: String?,
    val byline: String?,
    val wordCount: Int?,
)

private const val GCS_BUCKET = "htbase-archives-standard"
private const val MAX_DOWNLOAD_BYTES = 50L * 1024 * 1024 // 50MB
private const val THUMBNAIL_SIZE = 160
private const val THUMBNAIL_QUALITY = 80

@Singleton
class ArchiveService @Inject constructor(
    private val firestore: FirebaseFirestore,
    private val auth: FirebaseAuth,
    private val backupService: FirestoreBackupService,
    private val okHttpClient: OkHttpClient,
    private val localArchiveDao: LocalArchiveDao,
    private val articleDao: ArticleDao,
    private val application: Application,
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher,
) {
    private val archivesDir: File
        get() = File(application.filesDir, "archives")

    /** Limit concurrent archive downloads to cap peak memory from parallel decompress. */
    private val downloadSemaphore = Semaphore(3)

    // ── a) Firestore document listener ──────────────────────────────────

    fun observeRemoteArchives(itemId: String): Flow<Map<String, ArchiveStatus>> = callbackFlow {
        Timber.d("observeRemoteArchives($itemId) — attaching Firestore listener")
        val docRef = firestore.collection("articles").document(itemId)
        var hasSelfHealed = false
        var registration: ListenerRegistration? = null

        fun attach() {
            registration = docRef.addSnapshotListener { snapshot, error ->
                if (error != null) {
                    // Self-heal once on a denied read for an article we own:
                    // write the existence marker and re-attach the listener.
                    if (error.code == FirebaseFirestoreException.Code.PERMISSION_DENIED &&
                        !hasSelfHealed && auth.currentUser != null
                    ) {
                        hasSelfHealed = true
                        Timber.w(error, "observeRemoteArchives($itemId) — read denied, self-healing marker")
                        launch {
                            backupService.writeArticleMarker(itemId)
                            registration?.remove()
                            attach()
                        }
                        return@addSnapshotListener
                    }
                    // Unrecoverable (or already healed): surface a graceful empty
                    // state instead of leaving the flow hanging — never crash.
                    Timber.e(error, "observeRemoteArchives($itemId) — listener error, emitting empty")
                    trySend(emptyMap())
                    return@addSnapshotListener
                }
                if (snapshot == null || !snapshot.exists()) {
                    Timber.d("observeRemoteArchives($itemId) — doc missing or null, emitting empty")
                    trySend(emptyMap())
                    return@addSnapshotListener
                }

                val archives = mutableMapOf<String, ArchiveStatus>()
                @Suppress("UNCHECKED_CAST")
                val archivesMap = snapshot.get("archives") as? Map<String, Map<String, Any>> ?: emptyMap()
                for ((key, value) in archivesMap) {
                    val status = value["status"] as? String ?: continue
                    val gcsPath = value["gcs_path"] as? String
                    archives[key] = ArchiveStatus(status, gcsPath)
                }
                Timber.d("observeRemoteArchives($itemId) — emitting ${archives.size} archives: ${archives.map { "${it.key}=${it.value.status}" }}")
                trySend(archives)
            }
        }

        attach()
        awaitClose {
            Timber.d("observeRemoteArchives($itemId) — listener removed")
            registration?.remove()
        }
    }

    // ── b) Download archive from GCS → store locally ────────────────────

    suspend fun downloadAndStoreArchive(
        itemId: String,
        type: ArchiveType,
        gcsPath: String,
    ): LocalArchive? = withContext(ioDispatcher) {
        Timber.d("downloadAndStore($itemId, ${type.archiveKey}) — fetching from GCS: $gcsPath")

        val rawBytes = downloadFromGcs(gcsPath)
        if (rawBytes == null) {
            Timber.w("downloadAndStore($itemId, ${type.archiveKey}) — download returned null, skipping")
            return@withContext null
        }
        Timber.d("downloadAndStore($itemId, ${type.archiveKey}) — got ${rawBytes.size} bytes, gzipped=${isGzipped(rawBytes)}")
        val isAlreadyGzipped = isGzipped(rawBytes)

        val localDir = File(archivesDir, itemId)
        localDir.mkdirs()
        val localFile = File(localDir, type.localFilename)

        val compressedBytes: ByteArray
        val originalSize: Long

        if (isAlreadyGzipped) {
            compressedBytes = rawBytes
            val decompressed = decompress(rawBytes) ?: return@withContext null
            originalSize = decompressed.size.toLong()
        } else {
            originalSize = rawBytes.size.toLong()
            compressedBytes = gzipCompress(rawBytes)
        }

        localFile.writeBytes(compressedBytes)

        val relativePath = "archives/$itemId/${type.localFilename}"
        val archive = LocalArchive(
            itemId = itemId,
            archiveKey = type.archiveKey,
            localPath = relativePath,
            compressedSizeBytes = compressedBytes.size.toLong(),
            originalSizeBytes = originalSize,
            downloadedAt = System.currentTimeMillis(),
            status = "complete",
        )
        localArchiveDao.upsert(archive)
        Timber.d("Stored archive ${type.archiveKey} for $itemId (${compressedBytes.size} bytes)")
        archive
    }

    // ── c) Read local archive content ───────────────────────────────────

    suspend fun readArchiveText(itemId: String, type: ArchiveType): String? =
        withContext(ioDispatcher) {
            val localFile = getLocalArchiveFile(itemId, type) ?: return@withContext null
            val bytes = try {
                localFile.readBytes()
            } catch (e: java.io.IOException) {
                Timber.w(e, "readArchiveText($itemId, ${type.archiveKey}) — failed to read local file")
                return@withContext null
            }
            val decompressed = decompress(bytes)
            if (decompressed == null) {
                Timber.d("readArchiveText($itemId, ${type.archiveKey}) — decompression failed")
                return@withContext null
            }
            String(decompressed, Charsets.UTF_8)
        }

    fun getLocalArchiveFile(itemId: String, type: ArchiveType): File? {
        val file = File(archivesDir, "$itemId/${type.localFilename}")
        return if (file.exists()) file else null
    }

    // ── d) Download all available archives for an article ───────────────

    suspend fun syncArchives(
        itemId: String,
        remoteArchives: Map<String, ArchiveStatus>,
    ) = supervisorScope {
        Timber.d("syncArchives($itemId) — evaluating ${remoteArchives.size} remote archives")
        remoteArchives.mapNotNull { (key, status) ->
            val type = ArchiveType.fromArchiveKey(key)
            if (type == null) {
                Timber.d("syncArchives($itemId) — skip $key (not in ArchiveType enum)")
                return@mapNotNull null
            }
            if (status.status != "success" || status.gcsPath == null) {
                Timber.d("syncArchives($itemId) — skip ${type.archiveKey} (status=${status.status}, hasPath=${status.gcsPath != null})")
                return@mapNotNull null
            }

            // Check if already downloaded and file exists on disk
            val existing = localArchiveDao.getArchive(itemId, key)
            if (existing != null) {
                val file = File(archivesDir, "$itemId/${type.localFilename}")
                if (file.exists()) {
                    Timber.d("syncArchives($itemId) — skip ${type.archiveKey} (already on disk)")
                    return@mapNotNull null
                }
                Timber.d("syncArchives($itemId) — ${type.archiveKey} in Room but file missing, re-downloading")
            }

            Timber.d("syncArchives($itemId) — queuing download for ${type.archiveKey}")
            async {
                downloadSemaphore.withPermit {
                    try {
                        downloadAndStoreArchive(itemId, type, status.gcsPath)
                    } catch (e: UserRecoverableAuthException) {
                        Timber.w("Storage consent needed for ${type.archiveKey} download")
                        throw e // Propagate so caller can handle consent UI
                    } catch (e: Exception) {
                        Timber.e(e, "Failed to download ${type.archiveKey} for $itemId")
                    }
                }
            }
        }.forEach { it.await() }
        Timber.d("syncArchives($itemId) — all downloads complete")
    }

    // ── Top-level article read with self-heal ───────────────────────────

    /**
     * Read the top-level articles/{itemId} doc, self-healing once on a
     * PERMISSION_DENIED: write the owner's existence marker for [itemId] and
     * retry the read a single time. Returns null on a missing doc or an
     * unrecoverable failure — callers surface a graceful unavailable state and
     * never crash. The `articles` read rule is not yet tightened, so this path
     * is proven by unit test now and exercised end-to-end once it is tightened.
     */
    private suspend fun getArticleDocWithSelfHeal(itemId: String): DocumentSnapshot? {
        val docRef = firestore.collection("articles").document(itemId)
        var hasSelfHealed = false
        while (true) {
            try {
                return docRef.get().await()
            } catch (e: FirebaseFirestoreException) {
                if (e.code == FirebaseFirestoreException.Code.PERMISSION_DENIED &&
                    !hasSelfHealed && auth.currentUser != null
                ) {
                    hasSelfHealed = true
                    Timber.w(e, "getArticleDoc($itemId) — read denied, writing marker and retrying once")
                    backupService.writeArticleMarker(itemId)
                    continue
                }
                Timber.w(e, "getArticleDoc($itemId) — read failed (${e.code}), surfacing unavailable")
                return null
            }
        }
    }

    // ── e) Screenshot → image fallback ──────────────────────────────────

    suspend fun applyScreenshotAsImage(itemId: String) = withContext(ioDispatcher) {
        // Check if article already has an image
        val article = articleDao.getArticleById(itemId)
        if (article != null && !article.image.isNullOrBlank()) return@withContext

        // Fetch remote archive status to get screenshot gcs_path
        val doc = getArticleDocWithSelfHeal(itemId) ?: return@withContext
        if (!doc.exists()) return@withContext

        @Suppress("UNCHECKED_CAST")
        val screenshotEntry = (doc.get("archives") as? Map<String, Map<String, Any>>)
            ?.get("screenshot") ?: return@withContext

        val status = screenshotEntry["status"] as? String
        val gcsPath = screenshotEntry["gcs_path"] as? String
        if (status != "success" || gcsPath == null) return@withContext

        // Download screenshot PNG transiently
        val rawBytes = downloadFromGcs(gcsPath)
        if (rawBytes == null) {
            Timber.d("applyScreenshotAsImage($itemId) — screenshot download returned null")
            return@withContext
        }

        // Detect and decompress if gzipped
        val pngBytes = if (isGzipped(rawBytes)) {
            val decompressed = decompress(rawBytes)
            if (decompressed == null) {
                Timber.d("applyScreenshotAsImage($itemId) — screenshot decompression failed")
                return@withContext
            }
            decompressed
        } else {
            rawBytes
        }

        // Downscale to thumbnail
        val original = BitmapFactory.decodeByteArray(pngBytes, 0, pngBytes.size)
            ?: return@withContext
        val scaled = Bitmap.createScaledBitmap(original, THUMBNAIL_SIZE, THUMBNAIL_SIZE, true)
        original.recycle()

        val jpegStream = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, THUMBNAIL_QUALITY, jpegStream)
        scaled.recycle()

        val base64 = Base64.encodeToString(jpegStream.toByteArray(), Base64.NO_WRAP)
        val dataUri = "data:image/jpeg;base64,$base64"

        articleDao.updateImage(itemId, dataUri)
        Timber.d("Applied screenshot as image for $itemId (${jpegStream.size()} bytes thumbnail)")
    }

    // ── f) Metadata fetch ───────────────────────────────────────────────

    suspend fun fetchWargMetadata(itemId: String): WargMetadata? = withContext(ioDispatcher) {
        val doc = getArticleDocWithSelfHeal(itemId) ?: return@withContext null
        if (!doc.exists()) return@withContext null

        @Suppress("UNCHECKED_CAST")
        val metadata = doc.get("metadata") as? Map<String, Any> ?: return@withContext null

        WargMetadata(
            title = metadata["title"] as? String,
            excerpt = metadata["excerpt"] as? String,
            byline = metadata["byline"] as? String,
            wordCount = (metadata["word_count"] as? Number)?.toInt(),
        )
    }

    // ── GCS download via JSON API ──────────────────────────────────────

    private fun downloadFromGcs(gcsPath: String): ByteArray? {
        val objectPath = gcsPath
            .removePrefix("gs://$GCS_BUCKET/")
            .removePrefix("gs://htbase-archives-standard/")
        val encodedPath = URLEncoder.encode(objectPath, "UTF-8")
        val url = "https://storage.googleapis.com/storage/v1/b/$GCS_BUCKET/o/$encodedPath?alt=media"

        val googleAccount = GoogleSignIn.getLastSignedInAccount(application)?.account
        if (googleAccount == null) {
            Timber.w("downloadFromGcs — no Google account signed in")
            return null
        }
        // GoogleAuthUtil.getToken() may throw UserRecoverableAuthException — let it propagate
        val accessToken = GoogleAuthUtil.getToken(
            application,
            googleAccount,
            "oauth2:https://www.googleapis.com/auth/devstorage.read_only",
        )

        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $accessToken")
            .build()

        return try {
            okHttpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    Timber.w("GCS download failed: HTTP ${response.code} for $objectPath")
                    return@use null
                }

                // Pre-check: reject before downloading if Content-Length is known and too large
                val contentLength = response.header("Content-Length")?.toLongOrNull()
                if (contentLength != null && contentLength > MAX_DOWNLOAD_BYTES) {
                    Timber.w("GCS object too large: $contentLength bytes (limit: $MAX_DOWNLOAD_BYTES) for $objectPath")
                    return@use null
                }

                // Bounded read: enforce MAX_DOWNLOAD_BYTES even when Content-Length is absent
                val source = response.body?.source() ?: return@use null
                val buffer = okio.Buffer()
                var totalRead = 0L
                while (true) {
                    val bytesRead = source.read(buffer, 8192)
                    if (bytesRead == -1L) break
                    totalRead += bytesRead
                    if (totalRead > MAX_DOWNLOAD_BYTES) {
                        Timber.w("GCS download exceeded $MAX_DOWNLOAD_BYTES bytes, aborting for $objectPath")
                        return@use null
                    }
                }
                buffer.readByteArray()
            }
        } catch (e: java.io.IOException) {
            Timber.w(e, "downloadFromGcs — network error for $objectPath")
            null
        }
    }

    // ── Compression utilities ───────────────────────────────────────────

    private fun isGzipped(bytes: ByteArray): Boolean {
        return bytes.size >= 2 &&
            bytes[0] == 0x1f.toByte() &&
            bytes[1] == 0x8b.toByte()
    }

    private fun decompress(gzippedBytes: ByteArray): ByteArray? {
        GZIPInputStream(ByteArrayInputStream(gzippedBytes)).use { gzipStream ->
            val buffer = ByteArray(8192)
            // Pre-allocate with estimated decompression ratio (~4x) to reduce array doubling
            val estimatedSize = (gzippedBytes.size.toLong() * 4).coerceAtMost(MAX_DOWNLOAD_BYTES).toInt()
            val output = ByteArrayOutputStream(estimatedSize)
            var totalRead = 0L
            while (true) {
                val bytesRead = gzipStream.read(buffer)
                if (bytesRead == -1) break
                totalRead += bytesRead
                if (totalRead > MAX_DOWNLOAD_BYTES) {
                    Timber.w("Decompressed data exceeds ${MAX_DOWNLOAD_BYTES} byte limit, aborting")
                    return null
                }
                output.write(buffer, 0, bytesRead)
            }
            return output.toByteArray()
        }
    }

    private fun gzipCompress(bytes: ByteArray): ByteArray {
        val bos = ByteArrayOutputStream()
        GZIPOutputStream(bos).use { it.write(bytes) }
        return bos.toByteArray()
    }
}
