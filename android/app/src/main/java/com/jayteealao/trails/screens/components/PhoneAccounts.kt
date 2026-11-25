package com.jayteealao.trails.screens.components

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import timber.log.Timber

/** The phone's page that adds a Google account. */
internal fun addGoogleAccountIntent(): Intent =
    Intent(Settings.ACTION_ADD_ACCOUNT).putExtra(Settings.EXTRA_ACCOUNT_TYPES, arrayOf(GOOGLE_ACCOUNT_TYPE))

/**
 * Opens the phone's page that adds a Google account, else the phone's settings. [onClosed] runs
 * when the person comes back. When neither opens, nothing happens and the screen stays as it is.
 */
@Composable
fun rememberAddGoogleAccount(onClosed: () -> Unit): () -> Unit {
    val closed by rememberUpdatedState(onClosed)
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        closed()
    }
    return {
        val opened = listOf(addGoogleAccountIntent(), Intent(Settings.ACTION_SETTINGS)).any { intent ->
            try {
                launcher.launch(intent)
                true
            } catch (e: ActivityNotFoundException) {
                Timber.w(e, "No page opens %s", intent.action)
                false
            }
        }
        if (!opened) Timber.w("No page adds a Google account on this phone")
    }
}

/** The activity under this context, through any wrappers. */
tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

private const val GOOGLE_ACCOUNT_TYPE = "com.google"
