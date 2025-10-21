package com.jayteealao.trails.services.supabase

import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.common.generateDeterministicNanoId
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.network.ArticleAuthors
import com.jayteealao.trails.network.ArticleData
import com.jayteealao.trails.network.ArticleImages
import com.jayteealao.trails.network.ArticleTags
import com.jayteealao.trails.network.ArticleVideos
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.postgrest.PropertyConversionMethod
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.postgrest.result.PostgrestResult
import io.github.jan.supabase.realtime.Realtime
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SupabaseService @Inject constructor(
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher
) {

    private val supabaseClient: SupabaseClient by lazy {
        createSupabaseClient(
            supabaseUrl = "https://clqljjmgulkmczofejia.supabase.co",
            supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNscWxqam1ndWxrbWN6b2ZlamlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTI5MjQxMDQsImV4cCI6MjAyODUwMDEwNH0.TalJUTMUevwJJyex_UDvc0wWKVSubYNsdbaqgBWIn-c",
        ) {
            install(Postgrest) {
                propertyConversionMethod = PropertyConversionMethod.NONE
            }
            install(Realtime)
        }
    }

    private val summaryChannel by lazy {
        supabaseClient.channel("articleSummaryChannel")
    }

    suspend fun repopulateDatabase(count : Int = 0, saveData: suspend (List<ArticleData>) -> Unit = {}) = withContext(ioDispatcher){
            var OFFSET = 0L
            if (count > 0) {
                OFFSET = count.toLong()
            }
            while (true) {
                val end = OFFSET + 9
                val articles = supabaseClient.from("article").select() {
                    order("timeAdded", order = Order.DESCENDING)
                    range(from = OFFSET, to = end)
                }.decodeList<Article>()
                if (articles.isEmpty()) break
                //fetch related content
                saveData(
                    articles.map {
                        val images = supabaseClient.from("article_image").select() {
                            filter {
                                eq("item_id", it.itemId)
                            }
                        }.decodeList<ArticleImages>()
                        val videos = supabaseClient.from("article_video").select() {
                            filter {
                                eq("item_id", it.itemId)
                            }
                        }.decodeList<ArticleVideos>()
                        val tags = supabaseClient.from("article_tag").select() {
                            filter {
                                eq("item_id", it.itemId)
                            }
                        }.decodeList<ArticleTags>()
                        val authors = supabaseClient.from("article_author").select() {
                            filter {
                                eq("item_id", it.itemId)
                            }
                        }.decodeList<ArticleAuthors>()
                        ArticleData(
                            article = it.copy(
                                itemId = generateDeterministicNanoId(it.url ?: it.givenUrl ?: it.itemId),
                                remoteId = it.itemId,
                                resolved = true
                            ),
                            images = images,
                            videos = videos,
                            tags = tags,
                            authors = authors,
                            domainMetadata = null,
                        )
                    }
                )
//                if (OFFSET >= 40) break
                OFFSET += 10
            }
        }

    private fun provideSupabaseClient(): SupabaseClient = supabaseClient

    suspend fun addArticle(article: Article): PostgrestResult {
        return supabaseClient.from("article").upsert(article)
    }

    suspend fun addArticles(articles: List<Article>): PostgrestResult {
        return supabaseClient.from("article").upsert(articles)
    }

    suspend fun getSummaryById(id: String): PostgrestResult {
        return supabaseClient.from("article_summary").select() {
            filter {
                eq("id", id)
            }
        }
    }

    suspend fun observeChanges(collector: FlowCollector<List<ArticleSummary>>) {
        return summaryChanges.collect {
            when (it) {
                is PostgresAction.Insert -> {
                    Timber.d("Inserted: ${it.record}")
                    collector.emit(listOf(ArticleSummary(id = it.record["id"].toString(), summary = it.record["summary"].toString())))
                }
}

@Serializable
data class PageSnapshot(
    val item_id: String,
    val markdown: String,
    val length: Int
)