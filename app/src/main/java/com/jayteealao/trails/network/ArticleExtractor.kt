package com.jayteealao.trails.network

import com.chimbori.crux.Crux
import io.github.cdimascio.essence.Essence
import net.dankito.readability4j.extended.Readability4JExtended
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import org.jsoup.Jsoup
import java.net.URL
import javax.inject.Inject

class ArticleExtractor @Inject constructor(
    private val htmlFetcher: HtmlFetcher,
    private val okHttpClient: OkHttpClient
) {
    suspend fun extractEssence(url: URL): String? {
        val html = htmlFetcher.fetch(url) ?: return null
        return Essence.extract(html).text
    }

    suspend fun extractEssence(html: String): String? {
        return Essence.extract(html).text
    }

    suspend fun extractCrux(url: URL): String? {
//        val html = htmlFetcher.fetch(url) ?: return null
        return Crux(okHttpClient = okHttpClient)
            .extractFrom(url.toHttpUrlOrNull()!!)
            .article?.text()
    }

    suspend fun extractCrux(url: URL, html: String): String? {
        return Crux(okHttpClient = okHttpClient)
            .extractFrom(url.toHttpUrlOrNull()!!, Jsoup.parse(html))
            .article?.text()
    }

    suspend fun extractReadability(url: URL): String? {
        val html = htmlFetcher.fetch(url) ?: return null
        return try {
            Readability4JExtended(
                url.toString(),
                html = html
            ).parse().textContent
        } catch (e: Exception) {
            null
        }
    }

    suspend fun extractReadability(url: URL, html: String): String? {
        return try {
            Readability4JExtended(
                url.toString(),
                html = html
            ).parse().textContent
        } catch (e: Exception) {
            null
        }
    }

    suspend fun extractFromHtml(url: URL, html: String): String? {
        return extractReadability(url, html) ?: extractCrux(url, html) ?: extractEssence(html)
    }
}