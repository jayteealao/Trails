package com.jayteealao.trails.data.archive

import com.google.firebase.FirebaseNetworkException
import com.google.firebase.functions.FirebaseFunctions
import com.google.firebase.functions.FirebaseFunctionsException
import dagger.Lazy
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.tasks.await
import timber.log.Timber
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import javax.inject.Inject

/** Asks the server to run a failed archive again. */
interface ArchiveRetryClient {

    /** The answer for the user's article [itemId]. Throws only [CancellationException]. */
    suspend fun retry(itemId: String): ArchiveRetryAnswer
}

/** What the server, or the way to it, said to a retry. */
sealed interface ArchiveRetryAnswer {

    /** A run was started, was already going, or may have started. */
    data object Accepted : ArchiveRetryAnswer

    /** The archive is already complete; nothing was started. */
    data object Complete : ArchiveRetryAnswer

    /** Another run cannot help this page. */
    data object NotRetryable : ArchiveRetryAnswer

    /** Nothing is known to have started; a later tap is safe. */
    data class NotSent(val failure: RetryFailure) : ArchiveRetryAnswer
}

/** Why a retry was not sent, or got no answer. */
enum class RetryFailure { OFFLINE, SIGNED_OUT, REFUSED, NO_ANSWER }

/** [ArchiveRetryClient] over the `retryArchive` callable function (`warg/README.md`). */
class FirebaseArchiveRetryClient @Inject constructor(
    // Lazy: the SDK starts the Play services security provider on first use, so opening an
    // article must not create it.
    private val functions: Lazy<FirebaseFunctions>,
) : ArchiveRetryClient {

    override suspend fun retry(itemId: String): ArchiveRetryAnswer = try {
        val result = functions.get()
            .getHttpsCallable("retryArchive")
            .withTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .call(mapOf("itemId" to itemId))
            .await()
        answerOfResult(result.data).also { Timber.d("retry($itemId) — $it") }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        answerOfFailure(e).also {
            Timber.w("retry($itemId) — ${(e as? FirebaseFunctionsException)?.code ?: e.javaClass.simpleName}, $it")
        }
    }

    private companion object {
        /** The server answers after its own call to the archive service, which takes a while. */
        const val TIMEOUT_SECONDS = 120L
    }
}

/** The answer in the decoded body [data] of a call that succeeded. */
internal fun answerOfResult(data: Any?): ArchiveRetryAnswer = when ((data as? Map<*, *>)?.get("outcome")) {
    "started", "in_flight", "unconfirmed", "not_started" -> ArchiveRetryAnswer.Accepted
    "complete" -> ArchiveRetryAnswer.Complete
    "not_retryable" -> ArchiveRetryAnswer.NotRetryable
    "not_sent" -> ArchiveRetryAnswer.NotSent(RetryFailure.REFUSED)
    else -> ArchiveRetryAnswer.NotSent(RetryFailure.NO_ANSWER)
}

/**
 * The answer for a call that failed with [error]. The SDK reads the sign-in token before it sends
 * anything, and a failed read arrives wrapped in an ExecutionException, so the whole cause chain
 * is searched.
 */
internal fun answerOfFailure(error: Throwable): ArchiveRetryAnswer.NotSent {
    val chain = generateSequence(error) { it.cause }.take(MAX_CAUSES).toList()
    val call = chain.firstNotNullOfOrNull { it as? FirebaseFunctionsException }
    val failure = when {
        call?.code == FirebaseFunctionsException.Code.UNAUTHENTICATED -> RetryFailure.SIGNED_OUT
        chain.any { it is FirebaseNetworkException } -> RetryFailure.OFFLINE
        call?.code == FirebaseFunctionsException.Code.INTERNAL && call.cause is UnknownHostException ->
            RetryFailure.OFFLINE
        call == null -> RetryFailure.NO_ANSWER
        call.code == FirebaseFunctionsException.Code.DEADLINE_EXCEEDED -> RetryFailure.NO_ANSWER
        call.code == FirebaseFunctionsException.Code.INTERNAL -> RetryFailure.NO_ANSWER
        else -> RetryFailure.REFUSED
    }
    return ArchiveRetryAnswer.NotSent(failure)
}

/** A cause chain can be a loop. */
private const val MAX_CAUSES = 8
