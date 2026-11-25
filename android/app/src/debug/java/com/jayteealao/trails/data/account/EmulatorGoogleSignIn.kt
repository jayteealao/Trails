package com.jayteealao.trails.data.account

import android.content.Context

/**
 * A Google account for a debug build that points at the local Auth emulator
 * (-Ptrails.authEmulator=host:port): the emulator takes an unsigned token, so sign-in and the
 * account upgrade run against Firebase without a Google account on the phone. Null when no
 * emulator is set.
 */
fun emulatorGoogleSignIn(authEmulator: String): GoogleSignIn? {
    if (authEmulator.isBlank()) return null
    return object : GoogleSignIn {
        override suspend fun account(activity: Context) = GoogleAccount(
            idToken = """{"sub":"trails-emulator","email":"$EMULATOR_EMAIL","email_verified":true}""",
            email = EMULATOR_EMAIL,
        )

        override suspend fun forget() = Unit
    }
}

private const val EMULATOR_EMAIL = "mara@example.org"
