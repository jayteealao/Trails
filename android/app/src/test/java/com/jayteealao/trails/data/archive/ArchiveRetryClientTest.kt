package com.jayteealao.trails.data.archive

import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseNetworkException
import com.google.firebase.functions.FirebaseFunctions
import com.google.firebase.functions.FirebaseFunctionsException
import com.google.firebase.functions.FirebaseFunctionsException.Code
import com.google.firebase.functions.HttpsCallableReference
import com.google.firebase.functions.HttpsCallableResult
import com.jayteealao.trails.data.archive.ArchiveRetryAnswer.Accepted
import com.jayteealao.trails.data.archive.ArchiveRetryAnswer.Complete
import com.jayteealao.trails.data.archive.ArchiveRetryAnswer.NotRetryable
import com.jayteealao.trails.data.archive.ArchiveRetryAnswer.NotSent
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.net.ConnectException
import java.net.UnknownHostException
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit

/** How the answers and the failures of the retry call read in the app. */
class ArchiveRetryClientTest {

    private fun callError(code: Code, cause: Throwable? = null): FirebaseFunctionsException {
        val error = mockk<FirebaseFunctionsException>()
        every { error.code } returns code
        every { error.cause } returns cause
        return error
    }

    private fun failureOf(error: Throwable): RetryFailure = answerOfFailure(error).failure

    @Test
    fun `each outcome of the server has its answer`() {
        val answers = mapOf(
            "started" to Accepted,
            "in_flight" to Accepted,
            "unconfirmed" to Accepted,
            "not_started" to Accepted,
            "complete" to Complete,
            "not_retryable" to NotRetryable,
            "not_sent" to NotSent(RetryFailure.REFUSED),
        )
        for ((outcome, answer) in answers) {
            assertEquals(outcome, answer, answerOfResult(mapOf("outcome" to outcome)))
        }
        assertEquals(
            NotSent(RetryFailure.REFUSED),
            answerOfResult(mapOf("outcome" to "not_sent", "reason" to "operator_owned")),
        )
    }

    @Test
    fun `an unknown outcome or a malformed body is no answer`() {
        val bodies = listOf(
            mapOf("outcome" to "something_new"),
            mapOf("outcome" to 1),
            mapOf("outcome" to null),
            emptyMap<String, Any>(),
            "started",
            listOf("started"),
            null,
        )
        for (body in bodies) {
            assertEquals("$body", NotSent(RetryFailure.NO_ANSWER), answerOfResult(body))
        }
    }

    @Test
    fun `each error code has its failure`() {
        for (code in Code.entries) {
            val expected = when (code) {
                Code.UNAUTHENTICATED -> RetryFailure.SIGNED_OUT
                Code.DEADLINE_EXCEEDED, Code.INTERNAL -> RetryFailure.NO_ANSWER
                else -> RetryFailure.REFUSED
            }
            assertEquals("$code", expected, failureOf(callError(code)))
        }
    }

    @Test
    fun `an unknown host is offline, and another lost connection is no answer`() {
        assertEquals(RetryFailure.OFFLINE, failureOf(callError(Code.INTERNAL, UnknownHostException())))
        assertEquals(RetryFailure.NO_ANSWER, failureOf(callError(Code.INTERNAL, ConnectException())))
    }

    @Test
    fun `a sign-in token that could not be read for the network is offline, also when wrapped`() {
        val network = FirebaseNetworkException("no network")
        assertEquals(RetryFailure.OFFLINE, failureOf(network))
        assertEquals(RetryFailure.OFFLINE, failureOf(ExecutionException(network)))
    }

    @Test
    fun `any other throw is no answer, also with causes in a loop`() {
        assertEquals(RetryFailure.NO_ANSWER, failureOf(IllegalStateException("no app")))
        assertEquals(RetryFailure.NO_ANSWER, failureOf(IOException()))
        val first = RuntimeException("first")
        first.initCause(RuntimeException("second", first))
        assertEquals(RetryFailure.NO_ANSWER, failureOf(first))
    }

    // --- The call ---

    private val sent = mutableListOf<Any?>()

    private fun clientAnswering(task: Task<HttpsCallableResult>): FirebaseArchiveRetryClient {
        val callable = mockk<HttpsCallableReference>()
        every { callable.withTimeout(120, TimeUnit.SECONDS) } returns callable
        every { callable.call(any()) } answers {
            sent += firstArg<Any?>()
            task
        }
        val functions = mockk<FirebaseFunctions>()
        every { functions.getHttpsCallable("retryArchive") } returns callable
        return FirebaseArchiveRetryClient { functions }
    }

    @Test
    fun `the call names the article, waits two minutes and returns the answer`() = runTest {
        // The result holds its data in a field, so the real class is made, not a mock.
        val result = HttpsCallableResult::class.java.getDeclaredConstructor(Any::class.java)
            .apply { isAccessible = true }
            .newInstance(mapOf("outcome" to "started"))

        assertEquals(Accepted, clientAnswering(Tasks.forResult(result)).retry("item1234"))
        assertEquals(listOf<Any?>(mapOf("itemId" to "item1234")), sent)
    }

    @Test
    fun `a failed call returns its failure`() = runTest {
        val client = clientAnswering(Tasks.forException(ExecutionException(FirebaseNetworkException("x"))))
        assertEquals(NotSent(RetryFailure.OFFLINE), client.retry("item1234"))
    }

    @Test
    fun `a client that cannot be created is no answer`() = runTest {
        val client = FirebaseArchiveRetryClient { error("no Firebase app") }
        assertEquals(NotSent(RetryFailure.NO_ANSWER), client.retry("item1234"))
    }

    @Test
    fun `cancellation is rethrown`() = runTest {
        val client = FirebaseArchiveRetryClient { throw CancellationException("gone") }
        val thrown = try {
            client.retry("item1234")
            null
        } catch (e: CancellationException) {
            e
        }
        assertTrue(thrown is CancellationException)
    }
}
