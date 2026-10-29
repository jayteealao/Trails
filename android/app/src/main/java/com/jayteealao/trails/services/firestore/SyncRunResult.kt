package com.jayteealao.trails.services.firestore

import com.google.firebase.FirebaseNetworkException
import com.google.firebase.firestore.FirebaseFirestoreException
import java.io.IOException

/** What one sync run did, as the workers and callers see it. */
enum class SyncRunStatus {
    /** Nothing failed. Articles skipped after too many failed runs are not attempted. */
    SUCCESS,

    /** Some articles were pushed, and some failed or the run stopped early. */
    PARTIAL_FAILURE,

    /** Nothing was pushed and something failed. */
    FAILURE,

    /** No signed-in user: nothing to push. */
    NO_USER,
}

/**
 * The outcome of one push or full-sync run.
 *
 * @param pushed articles written to Firestore in this run
 * @param failed articles whose push failed for a reason of their own (each got a strike)
 * @param interruptedBy the transient failure that stopped the run early, if any (no strike)
 * @param noUser true when there was no signed-in user
 */
data class SyncRunResult(
    val pushed: Int,
    val failed: Int,
    val interruptedBy: Throwable? = null,
    val noUser: Boolean = false,
) {
    val status: SyncRunStatus
        get() = when {
            noUser -> SyncRunStatus.NO_USER
            failed == 0 && interruptedBy == null -> SyncRunStatus.SUCCESS
            pushed > 0 -> SyncRunStatus.PARTIAL_FAILURE
            else -> SyncRunStatus.FAILURE
        }

    operator fun plus(other: SyncRunResult): SyncRunResult = SyncRunResult(
        pushed = pushed + other.pushed,
        failed = failed + other.failed,
        interruptedBy = interruptedBy ?: other.interruptedBy,
        noUser = noUser || other.noUser,
    )
}

/** A backup call that did not finish within [ms] milliseconds (for example offline). */
class SyncTimeoutException(ms: Long) : Exception("Backup did not complete within $ms ms")

private val TRANSIENT_FIRESTORE_CODES = setOf(
    FirebaseFirestoreException.Code.UNAVAILABLE,
    FirebaseFirestoreException.Code.DEADLINE_EXCEEDED,
    FirebaseFirestoreException.Code.RESOURCE_EXHAUSTED,
    FirebaseFirestoreException.Code.ABORTED,
    FirebaseFirestoreException.Code.CANCELLED,
    FirebaseFirestoreException.Code.INTERNAL,
    FirebaseFirestoreException.Code.UNKNOWN,
    FirebaseFirestoreException.Code.UNAUTHENTICATED,
)

/**
 * True when the failure says nothing about the article itself (network, timeout, quota,
 * server trouble, sign-in), so the run is retried later without a strike. Any other
 * failure (for example an oversized document or a rejected write) is the article's own.
 * Looks at the throwable and its direct cause.
 */
internal fun Throwable.isTransientSyncFailure(): Boolean =
    isTransientItself() || (cause?.isTransientItself() == true)

private fun Throwable.isTransientItself(): Boolean = when (this) {
    is FirebaseFirestoreException -> code in TRANSIENT_FIRESTORE_CODES
    is FirebaseNetworkException -> true
    is IOException -> true
    is SyncTimeoutException -> true
    else -> false
}

/**
 * A run stopped because the local library is being cleared, or because the signed-in
 * account no longer owns it. Nothing more is written for the old account.
 */
class SyncAbortedException(message: String) : Exception(message)
