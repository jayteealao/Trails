package com.jayteealao.trails

import android.content.Context
import android.content.pm.ServiceInfo
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.work.CoroutineWorker
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.testing.TestListenableWorkerBuilder
import com.jayteealao.trails.sync.initializers.syncForegroundInfo
import com.jayteealao.trails.sync.workers.FirestoreRestoreWorker
import com.jayteealao.trails.sync.workers.FirestoreSyncWorker
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test

/**
 * The sync workers promote themselves to a foreground service typed dataSync, which Android 14
 * and newer require of an app targeting API 34 or higher. MainActivity stays resumed so the
 * promotion is not refused by the background-start rule, which is unrelated to the type.
 */
@HiltAndroidTest
class ForegroundWorkerTest {

    @get:Rule(order = 0)
    var hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeTestRule = createAndroidComposeRule<MainActivity>()

    private val context: Context = ApplicationProvider.getApplicationContext()

    @Before
    fun setUp() {
        hiltRule.inject()
    }

    @Test
    fun syncWorkers_declareTheDataSyncForegroundType() = runBlocking {
        val sync = TestListenableWorkerBuilder<FirestoreSyncWorker>(context).build()
        val restore = TestListenableWorkerBuilder<FirestoreRestoreWorker>(context).build()

        assertEquals(
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            sync.getForegroundInfo().foregroundServiceType,
        )
        assertEquals(
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            restore.getForegroundInfo().foregroundServiceType,
        )
    }

    @Test
    fun foregroundPromotion_succeedsThroughTheSystemForegroundService() = runBlocking {
        val workManager = WorkManager.getInstance(context)
        val request = OneTimeWorkRequestBuilder<ForegroundProbeWorker>().build()
        workManager.enqueue(request).result.get()

        val info = withTimeout(30_000) {
            workManager.getWorkInfoByIdFlow(request.id).first { it?.state?.isFinished == true }
        }

        assertEquals(
            "foreground promotion failed: ${ForegroundProbeWorker.failure}",
            WorkInfo.State.SUCCEEDED,
            info?.state,
        )
    }
}

/**
 * Promotes itself with the production foreground info, so the run goes through WorkManager's
 * real SystemForegroundService and fails on a missing or undeclared service type.
 */
class ForegroundProbeWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result = try {
        setForeground(applicationContext.syncForegroundInfo())
        Result.success()
    } catch (e: Exception) {
        failure = "${e::class.java.name}: ${e.message}"
        Result.failure()
    }

    companion object {
        @Volatile
        var failure: String? = null
    }
}
