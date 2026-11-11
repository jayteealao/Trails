package com.jayteealao.trails.common

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Whether the phone is online. Online means the default network has the internet capability; a
 * captive or not yet validated network counts as online, so the Reader never says it is offline
 * while a network is up.
 */
@Singleton
class NetworkMonitor @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    /** The current value first, then each change of the default network. */
    val isOnline: Flow<Boolean> = callbackFlow {
        val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        if (connectivity == null) {
            trySend(true)
            close()
            return@callbackFlow
        }
        trySend(connectivity.isOnlineNow())

        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                trySend(capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET))
            }

            override fun onLost(network: Network) {
                trySend(false)
            }
        }
        try {
            connectivity.registerDefaultNetworkCallback(callback)
        } catch (e: SecurityException) {
            Timber.w(e, "NetworkMonitor — cannot follow the network; keeping the current value")
            close()
            return@callbackFlow
        }
        awaitClose { connectivity.unregisterNetworkCallback(callback) }
    }.distinctUntilChanged()

    private fun ConnectivityManager.isOnlineNow(): Boolean {
        val network = activeNetwork ?: return false
        return getNetworkCapabilities(network)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
    }
}
