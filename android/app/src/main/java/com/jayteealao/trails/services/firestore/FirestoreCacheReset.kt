package com.jayteealao.trails.services.firestore

import android.content.Context
import com.google.firebase.firestore.FirebaseFirestore
import timber.log.Timber

/**
 * Clears the Firestore on-device cache after the local library was wiped, so the
 * previous account's documents do not stay on the device.
 *
 * Firestore clears its cache only while its client has not started, so a wipe records a
 * request ([request]) and the Firestore provider clears the cache at the next app start,
 * before any read or write ([clearIfRequested]). The request lives in its own
 * preferences file, so the app preferences clear after "Clear data" does not drop it.
 */
object FirestoreCacheReset {
    private const val PREFS = "firestore_cache_reset"
    private const val KEY_PENDING = "pending"

    /** Ask for the Firestore cache to be cleared at the next app start. */
    fun request(context: Context) {
        prefs(context).edit().putBoolean(KEY_PENDING, true).commit()
    }

    fun isRequested(context: Context): Boolean = prefs(context).getBoolean(KEY_PENDING, false)

    /**
     * Clear [firestore]'s cache when a wipe asked for it. Call on a fresh instance, before
     * its first read or write: the clear is queued ahead of the client's start. The
     * request stays until the clear succeeds, so a failed clear is tried at the next start.
     */
    fun clearIfRequested(context: Context, firestore: FirebaseFirestore) {
        if (!isRequested(context)) return
        try {
            firestore.clearPersistence()
                .addOnSuccessListener {
                    prefs(context).edit().remove(KEY_PENDING).apply()
                    Timber.i("Firestore cache cleared after a local data wipe")
                }
                .addOnFailureListener { e -> Timber.w(e, "Firestore cache not cleared; retrying at the next start") }
        } catch (e: Exception) {
            Timber.w(e, "Firestore cache not cleared; retrying at the next start")
        }
    }

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
