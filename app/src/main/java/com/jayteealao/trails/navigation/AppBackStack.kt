package com.jayteealao.trails.navigation

import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.jayteealao.trails.screens.Screen
import timber.log.Timber

/**
 * A back stack that handles routes requiring authentication.
 * Automatically redirects to login when accessing protected routes while logged out.
 *
 * Based on Android's Navigation 3 conditional navigation pattern.
 */
class AppBackStack(startRoute: Screen, private val loginRoute: Screen) {
    private var onLoginSuccessRoute: Screen? = null

    var isLoggedIn by mutableStateOf(startRoute != loginRoute)
        private set

    val backStack = mutableStateListOf(startRoute)

    init {
        Log.d(TAG, "AppBackStack initialized: startRoute=$startRoute, isLoggedIn=$isLoggedIn")
        logBackStack("init")
    }

    companion object {
        private const val TAG = "AppBackStack"
    }

    private fun logBackStack(operation: String) {
        Timber.tag(TAG).d(
            "[$operation] BackStack state: isLoggedIn=$isLoggedIn, stack=${
                backStack.joinToString(" -> ")
            }"
        )
    }

    fun add(route: Screen) {
        Timber.tag(TAG)
            .d("add() called: route=$route, requiresAuth=${route is Screen.RequiresAuth}, isLoggedIn=$isLoggedIn")

        if (route is Screen.RequiresAuth && !isLoggedIn) {
            // Store the intended destination and redirect to login
            onLoginSuccessRoute = route
            Timber.tag(TAG).d("Redirecting to login, stored destination: $onLoginSuccessRoute")
            backStack.add(loginRoute)
        } else {
            backStack.add(route)
        }

        // If the user explicitly requested the login route, don't redirect them after login
        if (route == loginRoute) {
            onLoginSuccessRoute = null
            Timber.tag(TAG).d("User requested login directly, cleared onLoginSuccessRoute")
        }

        logBackStack("add")
    }

    fun remove(): Screen? {
        val removed = backStack.removeLastOrNull()
        Timber.tag(TAG).d("remove() called: removed=$removed")
        logBackStack("remove")
        return removed
    }

    fun clear() {
        Timber.tag(TAG).d("clear() called")
        backStack.clear()
        logBackStack("clear")
    }

    fun login() {
        Timber.tag(TAG).d("login() called: onLoginSuccessRoute=$onLoginSuccessRoute")
        logBackStack("login-before")

        // Guard against duplicate login calls when already logged in
        if (isLoggedIn && backStack.lastOrNull() != loginRoute) {
            Timber.tag(TAG).w("Already logged in and not on login screen, skipping duplicate login")
            return
        }

        isLoggedIn = true

        // Navigate to stored destination or default to ArticleList
        val destinationRoute = onLoginSuccessRoute ?: Screen.ArticleList
        Timber.tag(TAG).d("Navigating to: $destinationRoute")

        backStack.add(destinationRoute)
        backStack.remove(loginRoute)
        onLoginSuccessRoute = null

        logBackStack("login-after")
    }

    fun logout() {
        Timber.tag(TAG).d("logout() called")
        logBackStack("logout-before")

        isLoggedIn = false

        val removedRoutes = backStack.filter { it is Screen.RequiresAuth }
        Timber.tag(TAG).d("Removing RequiresAuth routes: $removedRoutes")
        backStack.removeAll { it is Screen.RequiresAuth }

        // If backstack is empty or doesn't contain login, add it
        if (backStack.isEmpty() || backStack.last() != loginRoute) {
            Timber.tag(TAG).d("Adding login route (backStack empty or doesn't end with login)")
            backStack.add(loginRoute)
        } else {
            Timber.tag(TAG).d("Login already in backstack, not adding")
        }

        logBackStack("logout-after")
    }
}
