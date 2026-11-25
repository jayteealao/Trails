package com.jayteealao.trails.screens.components

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult

/**
 * Shows [url] in the browser of the phone. The browser is asked for by its category, because the
 * app itself takes web links, to save them, and would be offered or opened for a plain one.
 */
fun Context.openInBrowser(url: String) {
    val browser = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_BROWSER)
    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply { selector = browser })
}

/** Offers the apps of the phone an article to share. */
fun Context.shareArticle(title: String, url: String) {
    val send = Intent(Intent.ACTION_SEND).apply {
        putExtra(Intent.EXTRA_TEXT, "$title\n\n$url")
        type = "text/plain"
    }
    startActivity(Intent.createChooser(send, "Share article"))
}

/** Puts [url] on the clipboard under the name [label]. */
fun Context.copyLink(url: String, label: String) {
    val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText(label, url))
}

/** Says that an article was deleted, and runs [undo] when the person takes it back. */
suspend fun SnackbarHostState.showDeleted(undo: () -> Unit) {
    val result = showSnackbar(
        message = "Article deleted",
        actionLabel = "Undo",
        duration = SnackbarDuration.Long,
    )
    if (result == SnackbarResult.ActionPerformed) undo()
}
