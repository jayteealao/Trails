package com.jayteealao.trails.services.firestore

import com.google.firebase.firestore.FieldValue
import com.jayteealao.trails.data.local.database.Article

/**
 * Decides whether a restored Firestore article doc is deleted, and which write heals it.
 *
 * Deletions are stored under one key, [FIELD] (`deletedAt`, the name the bean serializer
 * writes). Older app versions wrote [LEGACY_FIELD] (`deleted_at`) with a merge instead,
 * so a legacy doc usually carries `deletedAt: null` next to `deleted_at: <millis>`.
 * Only a non-null value counts as a deletion.
 *
 * Rules:
 * - `deletedAt` set: deleted at that time; a present legacy key is dropped.
 * - only `deleted_at` set, at or after `timeUpdated`: deleted at that time, and the
 *   effective `timeUpdated` becomes `max(timeUpdated, deleted_at)` (the old delete
 *   bumped only the local row's `timeUpdated`); the doc is rewritten to `deletedAt`.
 * - only `deleted_at` set but older than `timeUpdated` (the article was saved again
 *   after the old delete): live; the legacy key is dropped.
 * - `deleted_at` present with a null value: live; the legacy key is dropped.
 * - neither key: unchanged, no heal.
 */
internal object RemoteDeletion {
    const val FIELD = "deletedAt"
    const val LEGACY_FIELD = "deleted_at"

    data class Resolution(val deletedAt: Long?, val timeUpdated: Long, val heal: Heal)

    sealed interface Heal {
        data object None : Heal
        data object DropLegacy : Heal
        data class PromoteLegacy(val deletedAt: Long, val timeUpdated: Long) : Heal
    }

    fun resolve(
        deletedAt: Long?,
        legacyDeletedAt: Long?,
        legacyPresent: Boolean,
        timeUpdated: Long,
    ): Resolution {
        val hasLegacyKey = legacyPresent || legacyDeletedAt != null
        return when {
            deletedAt != null -> Resolution(
                deletedAt = deletedAt,
                timeUpdated = timeUpdated,
                heal = if (hasLegacyKey) Heal.DropLegacy else Heal.None,
            )
            legacyDeletedAt != null && legacyDeletedAt >= timeUpdated -> {
                val effective = maxOf(timeUpdated, legacyDeletedAt)
                Resolution(
                    deletedAt = legacyDeletedAt,
                    timeUpdated = effective,
                    heal = Heal.PromoteLegacy(legacyDeletedAt, effective),
                )
            }
            hasLegacyKey -> Resolution(
                deletedAt = null,
                timeUpdated = timeUpdated,
                heal = Heal.DropLegacy,
            )
            else -> Resolution(deletedAt = null, timeUpdated = timeUpdated, heal = Heal.None)
        }
    }

    /** The merge-write fields that heal a doc, or null when the doc needs no write. */
    fun healFields(heal: Heal): Map<String, Any>? = when (heal) {
        Heal.None -> null
        Heal.DropLegacy -> mapOf(LEGACY_FIELD to FieldValue.delete())
        is Heal.PromoteLegacy -> mapOf(
            FIELD to heal.deletedAt,
            "timeUpdated" to heal.timeUpdated,
            LEGACY_FIELD to FieldValue.delete(),
        )
    }
}

/**
 * Applies a [RemoteDeletion.Resolution] to a restored article. A doc left by the old
 * merge-only delete of a never-backed-up article has no `itemId`; it takes the doc id.
 */
internal fun Article.withRemoteDeletion(r: RemoteDeletion.Resolution, docId: String): Article =
    copy(
        itemId = itemId.ifBlank { docId },
        deletedAt = r.deletedAt,
        timeUpdated = r.timeUpdated,
    )
