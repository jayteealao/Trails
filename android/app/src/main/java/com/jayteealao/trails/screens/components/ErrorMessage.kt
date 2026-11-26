package com.jayteealao.trails.screens.components

import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult

/**
 * Every failure a screen can tell, in fixed words: what failed and, where it helps, what to do.
 * An event holds one of these and never a Throwable, so no exception text can reach the screen.
 *
 * @property staysUntilAnswered the message has no other place on the screen, so it stays until
 *   the person answers it.
 */
enum class ErrorMessage(val text: String, val staysUntilAnswered: Boolean = false) {
    /** A change to an article or its tags did not reach the database. */
    CHANGE_FAILED("That change was not saved on this phone."),

    ARTICLE_MISSING("This article is no longer on this phone."),
    ARTICLE_HAS_NO_LINK("This article has no web address."),
    DETAILS_NOT_UPDATED("The article details were not updated."),

    OPEN_FAILED("The article did not open.", staysUntilAnswered = true),
    MARK_READ_FAILED("The article was not marked as read."),
    NO_BROWSER("No app on this phone opens this link."),

    SIGN_IN_OFFLINE("You’re offline, so you were not signed in. Connect, then try again."),
    SIGN_IN_FAILED("Sign-in did not finish. Try again."),

    GOOGLE_OFFLINE("You’re offline, so Google could not sign you in. Connect, then try again."),
    GOOGLE_NO_ACCOUNT(
        "There is no Google account on this phone. Add one in the phone’s settings, then come back."
    ),
    GOOGLE_FAILED(
        "Google did not finish signing you in. Nothing on this phone changed. Try again, or continue as a guest."
    ),
    SYNC_FAILED("Sync did not finish. Your articles are still on this phone. Try again."),
    CLEAR_DATA_FAILED("Clear data did not finish. Try again."),

    UPGRADE_FAILED("Your account was not upgraded. Your articles are still on this phone."),
    ACCOUNT_IN_USE(
        "That Google account already has a Trails library, so this one was not upgraded. " +
            "Your articles are still on this phone."
    ),
}

/** The label of every action that repeats what failed. */
const val TRY_AGAIN = "Try again"

/** Shows [message], with Try again when [retry] can repeat what failed. */
suspend fun SnackbarHostState.showError(message: ErrorMessage, retry: (() -> Unit)?) {
    val result = showSnackbar(
        message = message.text,
        actionLabel = if (retry != null) TRY_AGAIN else null,
        duration = when {
            retry == null -> SnackbarDuration.Short
            message.staysUntilAnswered -> SnackbarDuration.Indefinite
            else -> SnackbarDuration.Long
        },
    )
    if (result == SnackbarResult.ActionPerformed) retry?.invoke()
}
