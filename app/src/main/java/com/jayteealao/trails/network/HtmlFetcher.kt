package com.jayteealao.trails.network

import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import java.net.URL
import javax.inject.Inject

class HtmlFetcher @Inject constructor(
    private val okHttpClient: OkHttpClient,
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher
) {

    val coroutineScope = CoroutineScope(ioDispatcher)

//    check if its a google url that can be rewritten
    private fun canRewrite(url: HttpUrl) = url.host.contains("google.com") && url.encodedPath == "url"
// TODO: rewrite http://m.newyorker.com/online/blogs/culture/2014/01/this-week-in-fiction-george-saunders.html
    fun rewrite(url: HttpUrl): HttpUrl {
        val uri = url.toUri()
        val url = HttpUrl.Builder()
            .scheme("https")
            .host(uri.host)
            .encodedPath(uri.path)
            .build()
        if (!canRewrite(url)) return url

        var outputUrl: HttpUrl = url
        do {
            outputUrl = (
                    outputUrl.queryParameter("q") ?:
                    outputUrl.queryParameter("url"))
                ?.toHttpUrlOrNull() ?: outputUrl
        } while (canRewrite(outputUrl))
        return outputUrl
    }

    suspend fun fetch(url: URL): String? = withContext(ioDispatcher) {
        var httpUrl = url.toHttpUrlOrNull()
        if (httpUrl != null) {
            httpUrl = rewrite(httpUrl)
        } else return@withContext null
        val request = okHttpClient.newCall(
            okhttp3.Request.Builder()
                .url(httpUrl)
                .build()
        )
        val response = try { request.execute()
        } catch (e: Exception) {
            return@withContext null }

        return@withContext response.body?.string()
    }
}