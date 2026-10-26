package com.jayteealao.trails.services.firestore

import com.google.firebase.firestore.FieldValue
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.services.firestore.RemoteDeletion.Heal
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

/**
 * The rule that reads a restored deletion from the current key (`deletedAt`) or the
 * old key (`deleted_at`), and the heal write each case needs.
 */
class RemoteDeletionTest {

    @Test
    fun `deletedAt only is deleted and needs no heal`() {
        val r = RemoteDeletion.resolve(deletedAt = 500L, legacyDeletedAt = null, legacyPresent = false, timeUpdated = 500L)

        assertEquals(500L, r.deletedAt)
        assertEquals(500L, r.timeUpdated)
        assertEquals(Heal.None, r.heal)
        assertNull(RemoteDeletion.healFields(r.heal))
    }

    @Test
    fun `deleted_at only at or after timeUpdated is deleted, raises timeUpdated and promotes the key`() {
        val r = RemoteDeletion.resolve(deletedAt = null, legacyDeletedAt = 900L, legacyPresent = true, timeUpdated = 400L)

        assertEquals(900L, r.deletedAt)
        assertEquals(900L, r.timeUpdated)
        assertEquals(Heal.PromoteLegacy(deletedAt = 900L, timeUpdated = 900L), r.heal)

        val fields = RemoteDeletion.healFields(r.heal)!!
        assertEquals(900L, fields["deletedAt"])
        assertEquals(900L, fields["timeUpdated"])
        assertSame(FieldValue.delete(), fields["deleted_at"])
        assertEquals(3, fields.size)
    }

    @Test
    fun `deleted_at equal to timeUpdated counts as deleted`() {
        val r = RemoteDeletion.resolve(deletedAt = null, legacyDeletedAt = 400L, legacyPresent = true, timeUpdated = 400L)

        assertEquals(400L, r.deletedAt)
        assertEquals(400L, r.timeUpdated)
        assertEquals(Heal.PromoteLegacy(400L, 400L), r.heal)
    }

    @Test
    fun `both keys non-null with different values - deletedAt wins and the legacy key is dropped`() {
        val r = RemoteDeletion.resolve(deletedAt = 700L, legacyDeletedAt = 300L, legacyPresent = true, timeUpdated = 700L)

        assertEquals(700L, r.deletedAt)
        assertEquals(700L, r.timeUpdated)
        assertEquals(Heal.DropLegacy, r.heal)

        val fields = RemoteDeletion.healFields(r.heal)!!
        assertEquals(setOf("deleted_at"), fields.keys)
        assertSame(FieldValue.delete(), fields["deleted_at"])
    }

    @Test
    fun `deletedAt null with deleted_at set - the common legacy doc - is deleted at the legacy time`() {
        // Every backup wrote deletedAt: null, so a doc deleted by the old path holds both keys.
        val r = RemoteDeletion.resolve(deletedAt = null, legacyDeletedAt = 1_234L, legacyPresent = true, timeUpdated = 1_000L)

        assertEquals(1_234L, r.deletedAt)
        assertEquals(1_234L, r.timeUpdated)
        assertEquals(Heal.PromoteLegacy(1_234L, 1_234L), r.heal)
    }

    @Test
    fun `legacy deletion older than timeUpdated is superseded - live, legacy key dropped`() {
        val r = RemoteDeletion.resolve(deletedAt = null, legacyDeletedAt = 100L, legacyPresent = true, timeUpdated = 200L)

        assertNull(r.deletedAt)
        assertEquals(200L, r.timeUpdated)
        assertEquals(Heal.DropLegacy, r.heal)
    }

    @Test
    fun `legacy key present with a null value is live and the key is dropped`() {
        val r = RemoteDeletion.resolve(deletedAt = null, legacyDeletedAt = null, legacyPresent = true, timeUpdated = 200L)

        assertNull(r.deletedAt)
        assertEquals(200L, r.timeUpdated)
        assertEquals(Heal.DropLegacy, r.heal)
        assertEquals(setOf("deleted_at"), RemoteDeletion.healFields(r.heal)!!.keys)
    }

    @Test
    fun `neither key is live with no heal`() {
        val r = RemoteDeletion.resolve(deletedAt = null, legacyDeletedAt = null, legacyPresent = false, timeUpdated = 200L)

        assertNull(r.deletedAt)
        assertEquals(200L, r.timeUpdated)
        assertEquals(Heal.None, r.heal)
        assertNull(RemoteDeletion.healFields(r.heal))
    }

    @Test
    fun `withRemoteDeletion fills a blank itemId from the doc id`() {
        val r = RemoteDeletion.resolve(deletedAt = null, legacyDeletedAt = 50L, legacyPresent = true, timeUpdated = 0L)

        val restored = Article(itemId = "").withRemoteDeletion(r, docId = "doc-7")

        assertEquals("doc-7", restored.itemId)
        assertEquals(50L, restored.deletedAt)
        assertEquals(50L, restored.timeUpdated)
    }

    @Test
    fun `withRemoteDeletion keeps a non-blank itemId`() {
        val r = RemoteDeletion.resolve(deletedAt = 10L, legacyDeletedAt = null, legacyPresent = false, timeUpdated = 10L)

        val restored = Article(itemId = "item-1", timeUpdated = 10L).withRemoteDeletion(r, docId = "doc-7")

        assertEquals("item-1", restored.itemId)
        assertEquals(10L, restored.deletedAt)
    }
}
