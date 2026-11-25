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

    NO_LINK("There is no link to save."),
    LINK_NOT_SUPPORTED("Trails saves only links that start with http or https."),
    SAVE_FAILED("The article was not saved."),

    ARTICLE_MISSING("This article is no longer on this phone."),
    ARTICLE_HAS_NO_LINK("This article has no web address."),
    DETAILS_NOT_UPDATED("The article details were not updated."),

    OPEN_FAILED("The article did not open.", staysUntilAnswered = true),
    MARK_READ_FAILED("The article was not marked as read."),

    SIGN_IN_OFFLINE("You’re offline, so you were not signed in. Connect, then try again."),
    SIGN_IN_FAILED("Sign-in did not finish. Try again."),
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
