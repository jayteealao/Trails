package com.jayteealao.trails.data.archive

import android.app.Application
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GetTokenResult
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.remoteconfig.FirebaseRemoteConfig
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.di.ARCHIVE_SIGNED_URL_BASE_KEY
import com.jayteealao.trails.network.ArchiveUrlService
import com.jayteealao.trails.services.firestore.FirestoreBackupService
import io.mockk.MockKAnnotations
import io.mockk.clearAllMocks
import io.mockk.every
import io.mockk.impl.annotations.MockK
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

/**
 * Verifies the scoped signed-URL fetch path:
 *   (a) the signed-URL request hits the `/app/signed-url` endpoint (never the
 *       public GCS JSON API at storage.googleapis.com),
 *   (b) it carries `Authorization: Bearer <Firebase ID token>`,
 *   (c) the subsequent object GET (the signed URL) carries NO Authorization
 *       header (the signed URL is self-authorizing), and
 *   (d) the object bytes flow back through.
 *
 * A short-circuiting OkHttp interceptor records both requests and returns
 * canned responses, so the test is fully deterministic with no real sockets.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ArchiveServiceFetchTest {

    @MockK private lateinit var firestore: FirebaseFirestore
    @MockK private lateinit var auth: FirebaseAuth
    @MockK(relaxed = true) private lateinit var backupService: FirestoreBackupService
    @MockK private lateinit var remoteConfig: FirebaseRemoteConfig
    @MockK(relaxed = true) private lateinit var localArchiveDao: LocalArchiveDao
    @MockK(relaxed = true) private lateinit var articleDao: ArticleDao
    @MockK(relaxed = true) private lateinit var application: Application

    private val recorded = mutableListOf<Request>()
    private lateinit var service: ArchiveService

    @Before
    fun setUp() {
        MockKAnnotations.init(this)

        // Signed-in user → cached Firebase ID token.
        val user = mockk<FirebaseUser>()
        every { auth.currentUser } returns user
        val tokenResult = mockk<GetTokenResult>()
        every { tokenResult.token } returns "idtoken"
        every { user.getIdToken(false) } returns Tasks.forResult(tokenResult)

        every { remoteConfig.getString(ARCHIVE_SIGNED_URL_BASE_KEY) } returns "https://api.example"

        // One client for both legs (the Retrofit signed-URL call and the object
        // GET). The interceptor records each request and answers it directly:
        //   /app/signed-url → the signed-URL JSON pointing at the object,
        //   anything else   → the archive bytes.
        val client = OkHttpClient.Builder()
            .addInterceptor { chain ->
                val request = chain.request()
                recorded += request
                val isSignedUrlCall = request.url.encodedPath.endsWith("/app/signed-url")
                val (bodyStr, contentType) = if (isSignedUrlCall) {
                    """{"url":"https://archive.example/object"}""" to "application/json"
                } else {
                    "archive-bytes" to "application/octet-stream"
                }
                Response.Builder()
                    .request(request)
                    .protocol(Protocol.HTTP_1_1)
                    .code(200)
                    .message("OK")
                    .body(bodyStr.toResponseBody(contentType.toMediaType()))
                    .build()
            }
            .build()

        val archiveUrlService = Retrofit.Builder()
            .client(client)
            .baseUrl("https://api.example/") // nominal — @Url supplies the real per-call URL
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(ArchiveUrlService::class.java)

        service = ArchiveService(
            firestore = firestore,
            auth = auth,
            backupService = backupService,
            okHttpClient = client,
            archiveUrlService = archiveUrlService,
            remoteConfig = remoteConfig,
            localArchiveDao = localArchiveDao,
            articleDao = articleDao,
            application = application,
            ioDispatcher = UnconfinedTestDispatcher(),
        )
    }

    @After
    fun tearDown() {
        clearAllMocks()
        recorded.clear()
    }

    @Test
    fun `fetches via app signed-url with bearer then GETs the object with no auth header`() = runTest {
        val bytes = service.downloadArchive("item1234", "readability")

        // (d) bytes flow through
        assertNotNull(bytes)
        assertEquals("archive-bytes", String(bytes!!))
        assertEquals(2, recorded.size)

        // (a) + (b): signed-URL request hits /app/signed-url with the bearer token
        val signedReq = recorded[0]
        assertEquals("/app/signed-url", signedReq.url.encodedPath)
        assertEquals("api.example", signedReq.url.host)
        assertEquals("Bearer idtoken", signedReq.header("Authorization"))
        assertEquals("item1234", signedReq.url.queryParameter("itemId"))
        assertEquals("readability", signedReq.url.queryParameter("archiveKey"))

        // (c): the object GET (the signed URL) carries no Authorization header
        val objectReq = recorded[1]
        assertEquals("https://archive.example/object", objectReq.url.toString())
        assertNull(objectReq.header("Authorization"))
        // never the public GCS JSON API
        assertNotEquals("storage.googleapis.com", objectReq.url.host)
    }

    @Test
    fun `returns null and never calls the endpoint when not signed in`() = runTest {
        every { auth.currentUser } returns null

        val bytes = service.downloadArchive("item1234", "readability")

        assertNull(bytes)
        assertEquals(0, recorded.size)
    }
}
