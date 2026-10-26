package com.jayteealao.trails.data.account

import com.jayteealao.trails.data.SharedPreferencesManager
import javax.inject.Inject
import javax.inject.Singleton

/** What a sign-in means for the local library. */
enum class OwnerDecision {
    /** No owner is stored (first sign-in after the update, or after "Clear data"): take the data. */
    ADOPT,

    /** The signed-in uid already owns the data. */
    SAME_OWNER,

    /** Another uid owns the data: the device is cleared before this user gets it. */
    DIFFERENT_OWNER,
}

/**
 * The uid that owns the local library. A different uid signing in clears the device
 * first; a link keeps the uid, so it keeps the data.
 */
@Singleton
class LocalDataOwner @Inject constructor(
    private val prefs: SharedPreferencesManager,
) {
    fun uid(): String? = prefs.getLocalDataOwnerUid()

    /** The owner's email, or null for a guest owner. */
    fun label(): String? = prefs.getLocalDataOwnerLabel()

    fun decide(signedInUid: String): OwnerDecision {
        val owner = uid() ?: return OwnerDecision.ADOPT
        return if (owner == signedInUid) OwnerDecision.SAME_OWNER else OwnerDecision.DIFFERENT_OWNER
    }

    /** True when no owner is stored or [uid] is the owner. */
    fun isOwnedBy(uid: String): Boolean = prefs.getLocalDataOwnerUid().let { it == null || it == uid }

    fun adopt(uid: String, label: String?) = prefs.setLocalDataOwner(uid, label)

    fun clear() = prefs.clearLocalDataOwner()
}
