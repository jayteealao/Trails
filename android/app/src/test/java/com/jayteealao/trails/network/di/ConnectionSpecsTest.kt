package com.jayteealao.trails.network.di

import okhttp3.ConnectionSpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConnectionSpecsTest {

    private val tlsOnly = listOf(ConnectionSpec.MODERN_TLS, ConnectionSpec.COMPATIBLE_TLS)

    @Test
    fun `release build never allows cleartext, even with an http override`() {
        assertEquals(tlsOnly, connectionSpecsFor(debug = false, signedUrlBaseOverride = "http://10.0.2.2:8789"))
    }

    @Test
    fun `debug build without an override stays TLS only`() {
        assertEquals(tlsOnly, connectionSpecsFor(debug = true, signedUrlBaseOverride = ""))
    }

    @Test
    fun `debug build with an https override stays TLS only`() {
        assertFalse(ConnectionSpec.CLEARTEXT in connectionSpecsFor(debug = true, signedUrlBaseOverride = "https://stub.test"))
    }

    @Test
    fun `debug build with a plain-http stub override can fetch the stub's links`() {
        val specs = connectionSpecsFor(debug = true, signedUrlBaseOverride = "http://10.0.2.2:8789")
        assertTrue(ConnectionSpec.CLEARTEXT in specs)
        assertTrue(specs.containsAll(tlsOnly))
    }
}
