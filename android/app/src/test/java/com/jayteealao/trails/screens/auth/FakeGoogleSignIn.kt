package com.jayteealao.trails.screens.auth

import android.content.Context
import com.jayteealao.trails.data.account.GoogleAccount
import com.jayteealao.trails.data.account.GoogleSignIn
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred

/**
 * A Google account source for tests: it gives [account], or throws [failure]. While [picker]
 * is set, the picker stays open until it completes, and a cancelled wait is counted.
 */
class FakeGoogleSignIn(
    var account: GoogleAccount = GoogleAccount(idToken = TOKEN, email = EMAIL),
) : GoogleSignIn {
    var failure: Throwable? = null
    var picker: CompletableDeferred<Unit>? = null
    var forgetFailure: Throwable? = null

    var accountCalls = 0
        private set
    var pickerCancels = 0
        private set
    var forgetCalls = 0
        private set

    override suspend fun account(activity: Context): GoogleAccount {
        accountCalls++
        try {
            picker?.await()
        } catch (e: CancellationException) {
            pickerCancels++
            throw e
        }
        failure?.let { throw it }
        return account
    }

    override suspend fun forget() {
        forgetCalls++
        forgetFailure?.let { throw it }
    }

    companion object {
        const val TOKEN = "google-id-token"
        const val EMAIL = "mara@example.org"
    }
}
