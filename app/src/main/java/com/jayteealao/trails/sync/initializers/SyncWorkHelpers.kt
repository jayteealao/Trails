package com.jayteealao.trails.sync.initializers

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.getSystemService
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkManager
import com.jayteealao.trails.R

/**
 * Foreground information for sync on lower API levels when sync workers are being run with a
 * foreground service.
 */
context(CoroutineWorker)
fun Context.syncForegroundInfo() = ForegroundInfo(
    SyncNotificationId,
    syncWorkNotification()
)


/**
 * Notification displayed on lower API levels when sync workers are being run with a foreground
 * service.
 */
context(CoroutineWorker)
private fun Context.syncWorkNotification(): Notification {
    val cancelIntent = WorkManager.getInstance(this)
        .createCancelPendingIntent(id)
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    launchIntent?.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val launchPendingIntent = PendingIntent.getActivity(
        this,
        0,
        launchIntent,
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
    )
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val channel = NotificationChannel(
            SyncNotificationChannelID,
            getString(R.string.sync_notification_channel_name),
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = getString(R.string.sync_notification_channel_description)
        }

        val notificationManager = getSystemService<NotificationManager>()
        notificationManager?.createNotificationChannel(channel)
    }

    return NotificationCompat.Builder(this, SyncNotificationChannelID)
        .setSmallIcon(R.drawable.ic_launcher_foreground)
        .setContentTitle(getString(R.string.sync_notification_title))
        .setTicker(getString(R.string.sync_notification_title))
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .setOngoing(true)
        .setContentIntent(launchPendingIntent)
        .addAction(
            R.drawable.outline_cancel_24,
            getString(R.string.sync_notification_cancel),
            cancelIntent
        )
        .build()
}

private const val SyncNotificationId = 1000
private const val SyncNotificationChannelID = "SyncNotificationChannel"
