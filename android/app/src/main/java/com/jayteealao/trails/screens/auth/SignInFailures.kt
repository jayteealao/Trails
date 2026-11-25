package com.jayteealao.trails.screens.auth

import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.firebase.FirebaseNetworkException
import com.google.firebase.auth.FirebaseAuthUserCollisionException
import com.jayteealao.trails.screens.components.ErrorMessage
import java.util.concurrent.TimeoutException

/** The words for a failed guest sign-in: no network or no answer reads as offline, all else as failed. */
internal fun signInErrorOf(cause: Throwable): ErrorMessage =
    if (cause.hasNetworkCause()) ErrorMessage.SIGN_IN_OFFLINE else ErrorMessage.SIGN_IN_FAILED

/**
 * The words for a Google sign-in that failed before the library was handed over. Null when
 * the person cancelled: the screen shows what it showed before. [ErrorMessage.GOOGLE_NO_ACCOUNT]
 * is the no-account state. [online] is what the phone says about its network now.
 */
internal fun googleSignInErrorOf(cause: Throwable, online: Boolean): ErrorMessage? = when {
    cause.isPersonCancel() -> null
    cause.readsAsOffline(online) -> ErrorMessage.GOOGLE_OFFLINE
    cause is NoCredentialException -> ErrorMessage.GOOGLE_NO_ACCOUNT
    else -> ErrorMessage.GOOGLE_FAILED
}

/**
 * The words for a failed account upgrade. Null when the person cancelled, so nothing is said.
 * A Google account that already has its own library is refused, never signed in to.
 */
internal fun upgradeErrorOf(cause: Throwable, online: Boolean): ErrorMessage? = when {
    cause.isPersonCancel() -> null
    cause.readsAsOffline(online) -> ErrorMessage.GOOGLE_OFFLINE
    cause is NoCredentialException -> ErrorMessage.GOOGLE_NO_ACCOUNT
    cause is FirebaseAuthUserCollisionException -> ErrorMessage.ACCOUNT_IN_USE
    else -> ErrorMessage.UPGRADE_FAILED
}

/** The text of a sign-in [message]; a failed Google sign-in names the [account] when it is known. */
internal fun signInText(message: ErrorMessage, account: String?): String =
    if (message == ErrorMessage.GOOGLE_FAILED && account != null) {
        "Google did not finish signing in $account. Nothing on this phone changed. Try again, or continue as a guest."
    } else {
        message.text
    }

/**
 * A cancel that the person made. Play services also reports a failed re-authentication
 * ("[16] ... reauth ...") as a cancel; the person did not cancel that one.
 */
private fun Throwable.isPersonCancel(): Boolean {
    if (this !is GetCredentialCancellationException) return false
    val words = message.orEmpty()
    val reauthFailed = words.contains("reauth", ignoreCase = true) &&
        (words.contains("[16]") || words.contains("16:"))
    return !reauthFailed
}

/** A network failure in the cause chain, or a credential failure while the phone is offline. */
private fun Throwable.readsAsOffline(online: Boolean): Boolean =
    hasNetworkCause() || (!online && this is GetCredentialException)

private fun Throwable.hasNetworkCause(): Boolean =
    generateSequence(this) { it.cause }.take(MAX_CAUSES).any {
        it is FirebaseNetworkException || it is TimeoutException
    }

/** A cause chain can loop; no real one is this long. */
private const val MAX_CAUSES = 10
