package com.jayteealao.trails.network.di

import android.app.Application
import java.net.InetAddress
import java.net.ServerSocket
import java.util.Collections
import kotlin.concurrent.thread
import kotlinx.coroutines.runBlocking
import okhttp3.ConnectionSpec
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The client that reads pages, derived from a client that stands in for the one of the app. */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class PageClientTest {

    private val intercepted = Collections.synchronizedList(mutableListOf<String>())

    private val appClient = OkHttpClient.Builder()
        .connectionSpecs(listOf(ConnectionSpec.MODERN_TLS))
        .addInterceptor(
            Interceptor { chain ->
                intercepted += "app"
                chain.proceed(chain.request())
            },
        )
        .addNetworkInterceptor(
            Interceptor { chain ->
                intercepted += "network"
                chain.proceed(chain.request().newBuilder().header("User-Agent", CHROME_USER_AGENT).build())
            },
        )
        .build()

    private val pageClient = NetworkModule.providePageClient(appClient)

    @Test
    fun itSharesTheConnections_andEndsALongCall() {
        assertSame(appClient.connectionPool, pageClient.connectionPool)
        assertSame(appClient.dispatcher, pageClient.dispatcher)
        assertEquals(15_000, pageClient.callTimeoutMillis)
        assertTrue(pageClient.interceptors.isEmpty() && pageClient.networkInterceptors.isEmpty())
        assertTrue(pageClient.followRedirects && pageClient.followSslRedirects)
        assertEquals(
            listOf(ConnectionSpec.MODERN_TLS, ConnectionSpec.COMPATIBLE_TLS, ConnectionSpec.CLEARTEXT),
            pageClient.connectionSpecs,
        )
    }

    @Test
    fun itReadsAPlainHttpPage_withTheAgentOfTheReader() {
        val request = Collections.synchronizedList(mutableListOf<String>())
        ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { server ->
            val answering = thread {
                server.accept().use { socket ->
                    val lines = socket.getInputStream().bufferedReader()
                    while (true) {
                        val line = lines.readLine()
                        if (line.isNullOrEmpty()) break
                        request += line
                    }
                    val body = "<html><head><title>Trees</title></head></html>"
                    val head = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n" +
                        "Content-Length: ${body.length}\r\nConnection: close\r\n\r\n"
                    socket.getOutputStream().write((head + body).toByteArray())
                }
            }
            val page = runBlocking {
                NetworkModule.provideUnfurler(pageClient).unfurl("http://127.0.0.1:${server.localPort}/trees")
            }
            answering.join(10_000)
            assertEquals("Trees", page!!.title)
        }
        assertTrue("$request", request.any { it.startsWith("User-Agent: Slackbot-LinkExpanding") })
        assertTrue(intercepted.isEmpty())
    }

    @Test
    fun anUnfurlerAsksTheClientItIsGiven() {
        val asked = Collections.synchronizedList(mutableListOf<String>())
        val client = OkHttpClient.Builder().addInterceptor(
            Interceptor { chain ->
                asked += chain.request().url.toString()
                Response.Builder()
                    .request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                    .body("<html><head><title>Fake</title></head></html>".toResponseBody("text/html".toMediaType()))
                    .build()
            },
        ).build()

        val page = runBlocking { NetworkModule.provideUnfurler(client).unfurl("https://example.com/a") }

        assertEquals("Fake", page!!.title)
        assertEquals(listOf("https://example.com/a"), asked)
    }
}
