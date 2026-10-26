package com.jayteealao.trails.testing

import com.jayteealao.trails.data.account.LocalDataOwner
import io.mockk.every
import io.mockk.mockk

/**
 * For tests of the sync manager that are not about the owner guard: an owner that owns
 * every uid, so sync runs as it did before the guard existed.
 */
object TestLocalDataOwner {
    fun ownsEveryUid(): LocalDataOwner = mockk {
        every { isOwnedBy(any()) } returns true
        every { uid() } returns null
    }
}
