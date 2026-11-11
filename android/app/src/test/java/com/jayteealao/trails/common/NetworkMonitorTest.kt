package com.jayteealao.trails.common

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.runs
import io.mockk.slot
import io.mockk.verify
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/** Online means the default network can reach the internet; the flow follows the platform callback. */
@OptIn(ExperimentalCoroutinesApi::class)
class NetworkMonitorTest {

    private val context = mockk<Context>()
    private val connectivity = mockk<ConnectivityManager>()
    private val network = mockk<Network>()
    private val internet = mockk<NetworkCapabilities>().also {
        every { it.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) } returns true
    }
    private val registered = slot<ConnectivityManager.NetworkCallback>()

    private fun monitor(activeNetwork: Network?, capabilities: NetworkCapabilities?): NetworkMonitor {
        every { context.getSystemService(Context.CONNECTIVITY_SERVICE) } returns connectivity
        every { connectivity.activeNetwork } returns activeNetwork
        every { connectivity.getNetworkCapabilities(any()) } returns capabilities
        every { connectivity.registerDefaultNetworkCallback(capture(registered)) } just runs
        every { connectivity.unregisterNetworkCallback(any<ConnectivityManager.NetworkCallback>()) } just runs
        return NetworkMonitor(context)
    }

    @Test
    fun `no active network is offline`() = runTest {
        assertFalse(monitor(activeNetwork = null, capabilities = null).isOnline.first())
    }

    @Test
    fun `an active network with the internet capability is online`() = runTest {
        assertTrue(monitor(activeNetwork = network, capabilities = internet).isOnline.first())
    }

    @Test
    fun `the flow follows the default network, with no repeated value`() = runTest {
        val monitor = monitor(activeNetwork = null, capabilities = null)
        val values = mutableListOf<Boolean>()
        val job = launch(UnconfinedTestDispatcher(testScheduler)) { monitor.isOnline.toList(values) }

        registered.captured.onCapabilitiesChanged(network, internet)
        registered.captured.onCapabilitiesChanged(network, internet)
        registered.captured.onLost(network)

        assertEquals(listOf(false, true, false), values)
        job.cancel()
    }

    @Test
    fun `cancelling the collector unregisters the same callback`() = runTest {
        val monitor = monitor(activeNetwork = network, capabilities = internet)
        val job = launch(UnconfinedTestDispatcher(testScheduler)) { monitor.isOnline.collect {} }
        val callback = registered.captured

        job.cancel()
        testScheduler.advanceUntilIdle()

        val unregistered = slot<ConnectivityManager.NetworkCallback>()
        verify(exactly = 1) { connectivity.unregisterNetworkCallback(capture(unregistered)) }
        assertSame(callback, unregistered.captured)
    }

    @Test
    fun `a refused registration gives the current value and completes`() = runTest {
        val monitor = monitor(activeNetwork = network, capabilities = internet)
        every { connectivity.registerDefaultNetworkCallback(any()) } throws SecurityException("no permission")

        assertEquals(listOf(true), monitor.isOnline.toList())
    }
}
