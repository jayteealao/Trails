package com.jayteealao.trails.data.archive

import android.app.Application
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import com.google.android.gms.auth.GoogleAuthUtil
import com.google.android.gms.auth.UserRecoverableAuthException
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.firebase.firestore.FirebaseFirestore
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.data.local.database.ArticleDao
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.awaitClose
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
    private val okHttpClient: OkHttpClient,
    private val localArchiveDao: LocalArchiveDao,
    private val articleDao: ArticleDao,
    private val application: Application,
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher,
) {
    private val archivesDir: File
        get() = File(application.filesDir, "archives")

    // ── a) Firestore document listener ──────────────────────────────────

    fun observeRemoteArchives(itemId: String): Flow<Map<String, ArchiveStatus>> = callbackFlow {
        Timber.d("observeRemoteArchives($itemId) — attaching Firestore listener")
        val docRef = firestore.collection("articles").document(itemId)
        val listener = docRef.addSnapshotListener { snapshot, error ->
            if (error != null) {
                Timber.e(error, "observeRemoteArchives($itemId) — listener error")
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
        awaitClose {
            Timber.d("observeRemoteArchives($itemId) — listener removed")
            listener.remove()
        }
    }

    // ── a2) One-shot Firestore fetch (for delta checks) ────────────────

    suspend fun fetchRemoteArchiveStatus(itemId: String): Map<String, ArchiveStatus> =
        withContext(ioDispatcher) {
            val doc = firestore.collection("articles").document(itemId).get().await()
            if (!doc.exists()) return@withContext emptyMap()

            @Suppress("UNCHECKED_CAST")
            val archivesMap = doc.get("archives") as? Map<String, Map<String, Any>>
                ?: return@withContext emptyMap()

            archivesMap.mapNotNull { (key, value) ->
                val status = value["status"] as? String ?: return@mapNotNull null
                val gcsPath = value["gcs_path"] as? String
                key to ArchiveStatus(status, gcsPath)
            }.toMap()
        }

    // ── b) Download archive from GCS → store locally ────────────────────

    suspend fun downloadAndStoreArchive(
        itemId: String,
        type: ArchiveType,
        gcsPath: String,
    ): LocalArchive = withContext(ioDispatcher) {
        Timber.d("downloadAndStore($itemId, ${type.archiveKey}) — fetching from GCS: $gcsPath")

        val rawBytes = downloadFromGcs(gcsPath)
        Timber.d("downloadAndStore($itemId, ${type.archiveKey}) — got ${rawBytes.size} bytes, gzipped=${isGzipped(rawBytes)}")
        val isAlreadyGzipped = isGzipped(rawBytes)

        val localDir = File(archivesDir, itemId)
        localDir.mkdirs()
        val localFile = File(localDir, type.localFilename)

        val compressedBytes: ByteArray
        val originalSize: Long

        if (isAlreadyGzipped) {
            compressedBytes = rawBytes
            originalSize = decompress(rawBytes).size.toLong()
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
            val bytes = localFile.readBytes()
            String(decompress(bytes), Charsets.UTF_8)
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
                try {
                    downloadAndStoreArchive(itemId, type, status.gcsPath)
                } catch (e: UserRecoverableAuthException) {
                    Timber.w("Storage consent needed for ${type.archiveKey} download")
                    throw e // Propagate so caller can handle consent UI
                } catch (e: Exception) {
                    Timber.e(e, "Failed to download ${type.archiveKey} for $itemId")
                }
            }
        }.forEach { it.await() }
        Timber.d("syncArchives($itemId) — all downloads complete")
    }

    // ── e) Screenshot → image fallback ──────────────────────────────────

    suspend fun applyScreenshotAsImage(itemId: String) = withContext(ioDispatcher) {
        // Check if article already has an image
        val article = articleDao.getArticleById(itemId)
        if (article != null && !article.image.isNullOrBlank()) return@withContext

        // Fetch remote archive status to get screenshot gcs_path
        val doc = firestore.collection("articles").document(itemId).get().await()
        if (!doc.exists()) return@withContext

        @Suppress("UNCHECKED_CAST")
        val screenshotEntry = (doc.get("archives") as? Map<String, Map<String, Any>>)
            ?.get("screenshot") ?: return@withContext

        val status = screenshotEntry["status"] as? String
        val gcsPath = screenshotEntry["gcs_path"] as? String
        if (status != "success" || gcsPath == null) return@withContext

        // Download screenshot PNG transiently
        val rawBytes = downloadFromGcs(gcsPath)

        // Detect and decompress if gzipped
        val pngBytes = if (isGzipped(rawBytes)) decompress(rawBytes) else rawBytes

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
        val doc = firestore.collection("articles").document(itemId).get().await()
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

    private fun downloadFromGcs(gcsPath: String): ByteArray {
        // Convert gs://bucket/path to GCS JSON API URL
        val objectPath = gcsPath
            .removePrefix("gs://$GCS_BUCKET/")
            .removePrefix("gs://htbase-archives-standard/")
        val encodedPath = URLEncoder.encode(objectPath, "UTF-8")
        val url = "https://storage.googleapis.com/storage/v1/b/$GCS_BUCKET/o/$encodedPath?alt=media"

        // Get Google OAuth2 access token (not Firebase ID token)
        // allAuthenticatedUsers:objectViewer IAM on the bucket allows any Google account
        val googleAccount = GoogleSignIn.getLastSignedInAccount(application)?.account
            ?: throw IllegalStateException("No Google account signed in")
        val accessToken = GoogleAuthUtil.getToken(
            application,
            googleAccount,
            "oauth2:https://www.googleapis.com/auth/devstorage.read_only",
        )

        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $accessToken")
            .build()

        val response = okHttpClient.newCall(request).execute()
        if (!response.isSuccessful) {
            throw java.io.IOException("GCS download failed: HTTP ${response.code} for $objectPath")
        }
        return response.body?.bytes()
            ?: throw java.io.IOException("Empty response body for $objectPath")
    }

    // ── Compression utilities ───────────────────────────────────────────

    private fun isGzipped(bytes: ByteArray): Boolean {
        return bytes.size >= 2 &&
            bytes[0] == 0x1f.toByte() &&
            bytes[1] == 0x8b.toByte()
    }

    private fun decompress(gzippedBytes: ByteArray): ByteArray {
        return GZIPInputStream(ByteArrayInputStream(gzippedBytes)).use { it.readBytes() }
    }

    private fun gzipCompress(bytes: ByteArray): ByteArray {
        val bos = ByteArrayOutputStream()
        GZIPOutputStream(bos).use { it.write(bytes) }
        return bos.toByteArray()
    }
}
