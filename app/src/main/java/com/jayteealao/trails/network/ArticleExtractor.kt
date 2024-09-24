package com.jayteealao.trails.network

import com.chimbori.crux.Crux
import io.github.cdimascio.essence.Essence
import net.dankito.readability4j.Readability4J
import net.dankito.readability4j.extended.Readability4JExtended
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import org.jsoup.Jsoup
import javax.inject.Inject

class ArticleExtractor @Inject constructor(
    private val htmlFetcher: HtmlFetcher,
    private val okHttpClient: OkHttpClient,

) {

    private val crux: Lazy<Crux?> = lazy { Crux(okHttpClient = okHttpClient) }

    private var html: String? = null

    private var url: HttpUrl? = null

    private suspend fun extractEssence(): String? {
        return html?.let { Essence.extract(it).text }
    }

    private suspend fun extractCrux(): String? {
        return html?.let { crux.value!!.extractFrom(url!!, Jsoup.parse(it)).article?.text() }
    }

    private suspend fun extractReadability(): String? {
        var r4j: Readability4J? = html?.let { Readability4JExtended(url.toString(), it) }
        return try {
            val textContent = r4j?.parse()?.textContent
            r4j = null // Nullify the reference when it's no longer needed
            textContent
        } catch (e: Exception) {
            r4j = null // Nullify the reference when it's no longer needed
            null
        }
    }

    suspend operator fun invoke(url: HttpUrl?): String? {

        if(url == null) return null
        this.url = url
        html = htmlFetcher.fetch(url) ?: return null

        val essenceText = extractEssence()
        if (!essenceText.isNullOrBlank()) return essenceText
        val cruxText = extractCrux()
        if (!cruxText.isNullOrBlank()) return cruxText
        val readabilityText = extractReadability()
        if (!readabilityText.isNullOrBlank()) return readabilityText
        html = null // Nullify the reference when it's no longer needed
        this.url = null // Nullify the reference when it's no longer needed
        return null
    }

    suspend fun extractEssence(url: HttpUrl?): String? {
        if(url == null) return null

//        val html = htmlFetcher.fetch(url) ?: return null
        return Essence.extract(html ?: "").text
    }

    suspend fun extractEssence(html: String): String? {
        return Essence.extract(html).text
    }

    suspend fun extractCrux(url: HttpUrl?): String? {
        if(url == null) return null

//        val html = htmlFetcher.fetch(url) ?: return null
        return crux.value!!
            .extractFrom(url)
            .article?.text()
    }

    suspend fun extractCrux(url: HttpUrl?, html: String): String? {
        if(url == null) return null

        return crux.value
            ?.extractFrom(url, Jsoup.parse(html))
            ?.article?.text()

    }

    suspend fun extractReadability(url: HttpUrl?): String? {
        if(url == null) return null

//        val html = htmlFetcher.fetch(url) ?: return null
        var r4j: Readability4J? = Readability4JExtended(
            url.toString(),
            html = html ?: ""
        )
        return try {
            val textContent = r4j!!.parse().textContent
            r4j = null
            textContent
        } catch (e: Exception) {
            r4j = null
            null
        }
    }

    suspend fun extractReadability(url: HttpUrl?, html: String): String? {

        var r4j: Readability4J? = Readability4JExtended(
            url.toString(),
            html = html
        )
        return try {
            val textContent = r4j!!.parse().textContent
            r4j = null
            textContent
        } catch (e: Exception) {
            r4j = null
            null
        }
    }

    suspend fun extractFromHtml(url: HttpUrl?, html: String): String? {
        return extractReadability(url, html) ?: extractCrux(url, html) ?: extractEssence(html)
    }
}