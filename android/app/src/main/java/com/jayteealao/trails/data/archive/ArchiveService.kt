package com.jayteealao.trails.data.archive

import android.app.Application
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.remoteconfig.FirebaseRemoteConfig
import com.jayteealao.trails.BuildConfig
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.data.local.LocalFolders
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.di.ARCHIVE_SIGNED_URL_BASE_KEY
import com.jayteealao.trails.di.DEFAULT_DASHBOARD_API_URL
import com.jayteealao.trails.network.ArchiveUrlService
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import timber.log.Timber
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
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
    /**
     * Page lead image (`metadata.lead_image`), http(s) only; null when Warg found
     * none or the doc predates the field.
     */
    val leadImage: String? = null,
)

private const val MAX_DOWNLOAD_BYTES = 50L * 1024 * 1024 // 50MB
private const val THUMBNAIL_SIZE = 160
private const val THUMBNAIL_QUALITY = 80

/** Server-written field on users/{uid}/articles/{itemId} naming the shared article id. */
private const val CANONICAL_ID_FIELD = "canonicalId"

/** Preferences file of the background metadata pass: per article, "checks:lastCheckAt". */
private const val WARG_METADATA_PREFS = "warg_metadata_checks"

/** Articles the background metadata pass checks per call (one or two reads each). */
private const val WARG_METADATA_PASS_LIMIT = 10

/** Candidates read per call; most are skipped while their next check is not due. */
private const val WARG_METADATA_CANDIDATES = 100

@Singleton
class ArchiveService @Inject constructor(
    private val firestore: FirebaseFirestore,
    private val auth: FirebaseAuth,
    private val okHttpClient: OkHttpClient,
    private val archiveUrlService: ArchiveUrlService,
    private val remoteConfig: FirebaseRemoteConfig,
    private val localArchiveDao: LocalArchiveDao,
    private val articleDao: ArticleDao,
    private val application: Application,
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher,
) {
    private val archivesDir: File
        get() = File(application.filesDir, LocalFolders.ARCHIVES_DIR)

    /** Limit concurrent archive downloads to cap peak memory from parallel decompress. */
    private val downloadSemaphore = Semaphore(3)

    // ── Shared-article id resolver ──────────────────────────────────────
    //
    // The server records which shared article (articles/{id}) a user's article
    // links to in the `canonicalId` field of users/{uid}/articles/{itemId}. The
    // app only reads that field, live from Firestore; it is never stored locally
    // and never written by the app. Until the server has written it, the shared
    // id falls back to the user's own itemId.

    private fun userArticleRef(uid: String, itemId: String) =
        firestore.collection("users").document(uid)
            .collection("articles").document(itemId)

    /**
     * One-shot resolve of the shared article id for [itemId]: the server-written
     * `canonicalId` when present and non-blank, else [itemId]. A missing user,
     * a failed read or a missing field all fall back to [itemId].
     */
    internal suspend fun sharedArticleId(itemId: String): String {
        val uid = auth.currentUser?.uid ?: return itemId
        return try {
            val snapshot = userArticleRef(uid, itemId).get().await()
            (snapshot.get(CANONICAL_ID_FIELD) as? String)?.takeIf { it.isNotBlank() } ?: itemId
        } catch (e: FirebaseFirestoreException) {
            Timber.w(e, "sharedArticleId($itemId) — user doc read failed (${e.code}), using itemId")
            itemId
        }
    }

    /**
     * Live raw `canonicalId` of the user's article doc. Emits null when the
     * field is absent, when the listener errors, or when no user is signed in.
     */
    private fun observeCanonicalId(itemId: String): Flow<String?> {
        val uid = auth.currentUser?.uid ?: return flowOf(null)
        return callbackFlow {
            val registration = userArticleRef(uid, itemId).addSnapshotListener { snapshot, error ->
                if (error != null) {
                    Timber.w(error, "observeCanonicalId($itemId) — listener error, falling back to itemId")
                    trySend(null)
                    return@addSnapshotListener
                }
                trySend(snapshot?.get(CANONICAL_ID_FIELD) as? String)
            }
            awaitClose { registration.remove() }
        }
    }

    // ── a) Firestore document listener ──────────────────────────────────

    /**
     * Live archive map for the user's article [itemId], read from the shared
     * article the server linked it to. Follows the user doc's `canonicalId`:
     * when the server writes or changes it while the view is open, the listener
     * moves to the new shared article with no restart. Until the field exists,
     * the shared id is [itemId].
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun observeRemoteArchives(itemId: String): Flow<Map<String, ArchiveStatus>> =
        observeCanonicalId(itemId)
            .distinctUntilChanged()
            .flatMapLatest { raw ->
                observeSharedArchives(itemId, raw?.takeIf { it.isNotBlank() } ?: itemId)
            }

    /**
     * Snapshot listener on articles/{sharedId}. Any error, a denied read
     * included, logs and emits an empty map: the app writes nothing and does not
     * retry. A missing doc also emits an empty map.
     */
    private fun observeSharedArchives(
        itemId: String,
        sharedId: String,
    ): Flow<Map<String, ArchiveStatus>> = callbackFlow {
        Timber.d("observeRemoteArchives($itemId) — attaching listener on shared id $sharedId")
        val registration = firestore.collection("articles").document(sharedId)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    Timber.e(error, "observeRemoteArchives($itemId) — shared id $sharedId listener error (${error.code}), emitting empty")
                    trySend(emptyMap())
                    return@addSnapshotListener
                }
                if (snapshot == null || !snapshot.exists()) {
                    Timber.d("observeRemoteArchives($itemId) — shared id $sharedId doc missing or null, emitting empty")
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
                Timber.d("observeRemoteArchives($itemId) — shared id $sharedId — emitting ${archives.size} archives: ${archives.map { "${it.key}=${it.value.status}" }}")
                trySend(archives)
            }
        awaitClose {
            Timber.d("observeRemoteArchives($itemId) — listener on shared id $sharedId removed")
            registration.remove()
        }
    }

    // ── b) Download archive from GCS → store locally ────────────────────

    suspend fun downloadAndStoreArchive(
        itemId: String,
        type: ArchiveType,
    ): LocalArchive? = withContext(ioDispatcher) {
        Timber.d("downloadAndStore($itemId, ${type.archiveKey}) — fetching via signed URL")

        val rawBytes = downloadArchive(itemId, type.archiveKey)
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
                        downloadAndStoreArchive(itemId, type)
                    } catch (e: Exception) {
                        Timber.e(e, "Failed to download ${type.archiveKey} for $itemId")
                    }
                }
            }
        }.forEach { it.await() }
        Timber.d("syncArchives($itemId) — all downloads complete")
    }

    // ── One-shot shared article read ────────────────────────────────────

    /**
     * Read the shared article doc for the user's article [itemId], resolved
     * through [sharedArticleId]. Returns null on a failed read (a denied read
     * included) with no write and no retry; callers surface a graceful
     * unavailable state and never crash.
     */
    private suspend fun getSharedArticleDoc(itemId: String): DocumentSnapshot? {
        val sharedId = sharedArticleId(itemId)
        return try {
            firestore.collection("articles").document(sharedId).get().await()
        } catch (e: FirebaseFirestoreException) {
            Timber.w(e, "getSharedArticleDoc($itemId) — shared id $sharedId read failed (${e.code}), surfacing unavailable")
            null
        }
    }

    // ── e) Screenshot → image fallback ──────────────────────────────────

    suspend fun applyScreenshotAsImage(itemId: String) = withContext(ioDispatcher) {
        // Check if article already has an image
        val article = articleDao.getArticleById(itemId)
        if (article != null && !article.image.isNullOrBlank()) return@withContext

        // Fetch remote archive status to get screenshot gcs_path
        val doc = getSharedArticleDoc(itemId) ?: return@withContext
        if (!doc.exists()) return@withContext

        @Suppress("UNCHECKED_CAST")
        val screenshotEntry = (doc.get("archives") as? Map<String, Map<String, Any>>)
            ?.get("screenshot") ?: return@withContext

        val status = screenshotEntry["status"] as? String
        val gcsPath = screenshotEntry["gcs_path"] as? String
        // gcs_path presence is the readiness signal; the object is fetched via
        // the scoped signed-URL path, not the gs:// path directly.
        if (status != "success" || gcsPath == null) return@withContext

        // Download screenshot PNG transiently
        val rawBytes = downloadArchive(itemId, "screenshot")
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
        val doc = getSharedArticleDoc(itemId) ?: return@withContext null
        if (!doc.exists()) return@withContext null

        @Suppress("UNCHECKED_CAST")
        val metadata = doc.get("metadata") as? Map<String, Any> ?: return@withContext null

        WargMetadata(
            title = metadata["title"] as? String,
            excerpt = metadata["excerpt"] as? String,
            byline = metadata["byline"] as? String,
            wordCount = (metadata["word_count"] as? Number)?.toInt(),
            leadImage = (metadata["lead_image"] as? String)?.trim()?.takeIf { it.isNotEmpty() },
        )
    }

    // ── g) Metadata → image and author rows ─────────────────────────────

    /**
     * Turn the Warg metadata of [itemId] into its lead-image row and byline row
     * and choose the article image (lead image first, archived screenshot when
     * there is none). Writes only missing or changed rows; the row write raises
     * `timeUpdated`, so the next push carries the rows. A repeat run with the same
     * metadata writes nothing. A missing or deleted article, or no metadata, is a
     * no-op.
     */
    suspend fun applyWargMetadata(itemId: String) {
        applyWargMetadataIfPresent(itemId)
    }

    /** [applyWargMetadata], returning true when Warg metadata for [itemId] was found. */
    private suspend fun applyWargMetadataIfPresent(itemId: String): Boolean = withContext(ioDispatcher) {
        val article = articleDao.getArticleById(itemId) ?: return@withContext false
        if (article.deletedAt != null) return@withContext false
        val metadata = fetchWargMetadata(itemId) ?: return@withContext false

        val plan = planWargRows(
            itemId = itemId,
            metadata = metadata,
            currentImage = article.image,
            existingImages = articleDao.getImagesForArticles(listOf(itemId)),
            existingAuthors = articleDao.getAuthorsForArticles(listOf(itemId)),
        )
        when (val choice = plan.image) {
            is ImageChoice.UseLeadImage -> articleDao.updateImage(itemId, choice.url)
            ImageChoice.UseScreenshot -> applyScreenshotAsImage(itemId)
            ImageChoice.Keep -> Unit
        }
        if (plan.images.isNotEmpty() || plan.authors.isNotEmpty()) {
            articleDao.addLocalArticleRows(itemId, plan.images, plan.authors, System.currentTimeMillis())
        }
        Timber.d(
            "applyWargMetadata($itemId) — lead=${if (usableLeadImage(metadata.leadImage) != null) "present" else "absent"} " +
                "byline=${if (metadata.byline.isNullOrBlank()) "absent" else "present"} " +
                "rows=${plan.images.size + plan.authors.size} image=${plan.image::class.simpleName}",
        )
        true
    }

    /**
     * Apply Warg metadata to recently saved articles that have no lead-image or byline row
     * yet, so an article gets its rows after Warg archives it even if it is never opened.
     * Checks at most [limit] articles per call; each article is checked a few times with
     * growing waits ([wargMetadataCheckDue]) and not again once its metadata was found.
     * Returns the number of articles whose metadata was found.
     */
    suspend fun applyMissingWargMetadata(
        now: Long = System.currentTimeMillis(),
        limit: Int = WARG_METADATA_PASS_LIMIT,
    ): Int = withContext(ioDispatcher) {
        if (auth.currentUser == null) return@withContext 0
        val prefs = application.getSharedPreferences(WARG_METADATA_PREFS, Context.MODE_PRIVATE)
        val since = now - WARG_METADATA_WINDOW_MS
        val candidates = articleDao.getRecentArticlesWithoutWargRows(since, WARG_METADATA_CANDIDATES)
        val editor = prefs.edit()
        // Forget articles that left the window or got their rows.
        prefs.all.keys.filter { it !in candidates }.forEach { editor.remove(it) }
        var checked = 0
        var found = 0
        for (itemId in candidates) {
            if (checked >= limit) break
            val (checks, lastAt) = parseChecks(prefs.getString(itemId, null))
            if (!wargMetadataCheckDue(checks, lastAt, now)) continue
            checked++
            val present = try {
                applyWargMetadataIfPresent(itemId)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Timber.w(e, "applyMissingWargMetadata($itemId) failed")
                false
            }
            if (present) found++
            val nextChecks = if (present) WARG_METADATA_MAX_CHECKS else checks + 1
            editor.putString(itemId, "$nextChecks:$now")
        }
        editor.apply()
        if (checked > 0) Timber.d("applyMissingWargMetadata — checked=$checked found=$found")
        found
    }

    private fun parseChecks(value: String?): Pair<Int, Long> {
        val parts = value?.split(':') ?: return 0 to 0L
        val checks = parts.getOrNull(0)?.toIntOrNull() ?: return 0 to 0L
        return checks to (parts.getOrNull(1)?.toLongOrNull() ?: 0L)
    }

    // ── Scoped archive download via per-user signed URL ─────────────────

    /**
     * Fetch an archive object via the scoped, owner-checked signed-URL path:
     * exchange the signed-in user's Firebase ID token at `/app/signed-url` for a
     * short-lived V4 signed GCS URL, then GET the object directly (the signed
     * URL carries its own auth in the query string — no Authorization header).
     *
     * Returns null when the user is not signed in, the signing request fails, or
     * the object fetch fails — callers degrade to a graceful unavailable state.
     */
    // internal (not private) so the signed-URL fetch path can be unit-tested
    // directly without exercising the file-I/O / bitmap decode of the public
    // callers (see ArchiveServiceFetchTest).
    internal suspend fun downloadArchive(itemId: String, archiveKey: String): ByteArray? {
        val user = auth.currentUser
        if (user == null) {
            Timber.w("downloadArchive($itemId, $archiveKey) — no signed-in user, skipping")
            return null
        }

        val token = try {
            user.getIdToken(false).await().token
        } catch (e: Exception) {
            Timber.w(e, "downloadArchive($itemId, $archiveKey) — getIdToken failed, skipping")
            return null
        }
        if (token == null) {
            Timber.w("downloadArchive($itemId, $archiveKey) — null ID token, skipping")
            return null
        }

        // Debug-only override (a Gradle property) points the signed-link request
        // at a local stub for emulator runs; release builds always use remote config.
        val base = BuildConfig.SIGNED_URL_BASE_OVERRIDE.takeIf { BuildConfig.DEBUG && it.isNotBlank() }
            ?: remoteConfig.getString(ARCHIVE_SIGNED_URL_BASE_KEY).ifBlank { DEFAULT_DASHBOARD_API_URL }
        val endpoint = "$base/app/signed-url"

        val signedUrl = try {
            archiveUrlService.getSignedUrl(endpoint, "Bearer $token", itemId, archiveKey).url
        } catch (e: Exception) {
            Timber.w(e, "downloadArchive($itemId, $archiveKey) — signed-URL request failed")
            return null
        }

        return withContext(ioDispatcher) { fetchObjectBytes(signedUrl) }
    }

    /**
     * GET an object URL with a bounded read (no Authorization header — the
     * signed URL is self-authorizing). Enforces [MAX_DOWNLOAD_BYTES] whether or
     * not the server reports a Content-Length.
     */
    private fun fetchObjectBytes(url: String): ByteArray? {
        val request = Request.Builder().url(url).build()
        return try {
            okHttpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    Timber.w("Signed-URL object fetch failed: HTTP ${response.code}")
                    return@use null
                }

                // Pre-check: reject before downloading if Content-Length is known and too large
                val contentLength = response.header("Content-Length")?.toLongOrNull()
                if (contentLength != null && contentLength > MAX_DOWNLOAD_BYTES) {
                    Timber.w("Archive object too large: $contentLength bytes (limit: $MAX_DOWNLOAD_BYTES)")
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
                        Timber.w("Archive download exceeded $MAX_DOWNLOAD_BYTES bytes, aborting")
                        return@use null
                    }
                }
                buffer.readByteArray()
            }
        } catch (e: java.io.IOException) {
            Timber.w(e, "fetchObjectBytes — network error")
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
