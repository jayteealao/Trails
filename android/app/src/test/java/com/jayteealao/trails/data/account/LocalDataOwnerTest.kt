package com.jayteealao.trails.data.account

import android.app.Application
import com.jayteealao.trails.data.SharedPreferencesManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * The owner of the local library, stored in the app's real preferences: no owner adopts,
 * the same uid keeps, another uid replaces; clearing the owner or all preferences forgets it.
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class LocalDataOwnerTest {

    private lateinit var prefs: SharedPreferencesManager
    private lateinit var owner: LocalDataOwner

    @Before
    fun setUp() {
        prefs = SharedPreferencesManager(RuntimeEnvironment.getApplication())
        prefs.clear()
        owner = LocalDataOwner(prefs)
    }

    @Test
    fun noOwner_adoptsAndOwnsEveryUid() {
        assertNull(owner.uid())
        assertEquals(OwnerDecision.ADOPT, owner.decide("a"))
        assertTrue(owner.isOwnedBy("a"))
        assertTrue(owner.isOwnedBy("b"))
    }

    @Test
    fun sameUid_isSameOwner_otherUid_isDifferentOwner() {
        owner.adopt("a", "a@example.com")

        assertEquals("a", owner.uid())
        assertEquals("a@example.com", owner.label())
        assertEquals(OwnerDecision.SAME_OWNER, owner.decide("a"))
        assertEquals(OwnerDecision.DIFFERENT_OWNER, owner.decide("b"))
        assertTrue(owner.isOwnedBy("a"))
        assertFalse(owner.isOwnedBy("b"))
    }

    @Test
    fun guestOwner_hasNoLabel_andAdoptingWithoutLabelDropsTheOldOne() {
        owner.adopt("a", "a@example.com")
        owner.adopt("g", null)

        assertEquals("g", owner.uid())
        assertNull(owner.label())
    }

    @Test
    fun clear_forgetsTheOwner() {
        owner.adopt("a", "a@example.com")

        owner.clear()

        assertNull(owner.uid())
        assertNull(owner.label())
        assertEquals(OwnerDecision.ADOPT, owner.decide("b"))
    }

    @Test
    fun clearingAllPreferences_forgetsTheOwner() {
        owner.adopt("a", "a@example.com")

        prefs.clear()

        assertNull(owner.uid())
        assertNull(owner.label())
    }
}
