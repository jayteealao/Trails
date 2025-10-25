package com.jayteealao.trails.services.supabase
//
//import com.jayteealao.trails.common.di.dispatchers.Dispatcher
//import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
//import com.jayteealao.trails.common.generateDeterministicNanoId
//import com.jayteealao.trails.data.local.database.PocketArticle
//import com.jayteealao.trails.network.PocketAuthors
//import com.jayteealao.trails.network.PocketData
//import com.jayteealao.trails.network.PocketImages
//import com.jayteealao.trails.network.PocketTags
//import com.jayteealao.trails.network.PocketVideos
//import io.github.jan.supabase.SupabaseClient
//import io.github.jan.supabase.createSupabaseClient
//import io.github.jan.supabase.postgrest.Postgrest
//import io.github.jan.supabase.postgrest.PropertyConversionMethod
//import io.github.jan.supabase.postgrest.from
//import io.github.jan.supabase.postgrest.query.Order
//import io.github.jan.supabase.postgrest.result.PostgrestResult
//import io.github.jan.supabase.realtime.Realtime
//import kotlinx.coroutines.CoroutineDispatcher
//import kotlinx.coroutines.withContext
//import kotlinx.serialization.Serializable
//import javax.inject.Inject
//import javax.inject.Singleton
//
//@Singleton
//class SupabaseService @Inject constructor(
//    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher
//) {
//
//    private val supabaseClient: SupabaseClient by lazy {
//        createSupabaseClient(
//            supabaseUrl = "https://clqljjmgulkmczofejia.supabase.co",
//            supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNscWxqam1ndWxrbWN6b2ZlamlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTI5MjQxMDQsImV4cCI6MjAyODUwMDEwNH0.TalJUTMUevwJJyex_UDvc0wWKVSubYNsdbaqgBWIn-c",
//        ) {
//            install(Postgrest) {
//                propertyConversionMethod = PropertyConversionMethod.NONE
//            }
//            install(Realtime)
//        }
//    }
//
////    private val summaryChannel by lazy {
////        supabaseClient.channel("pocketSummaryChannel")
////    }
////
////    val summaryChanges = summaryChannel.postgresChangeFlow<PostgresAction>(schema = "public") {
////            table = "pocketsummary"
////        }
//
//    suspend fun repopulateDatabase(count : Int = 0, saveData: suspend (List<PocketData>) -> Unit = {}) = withContext(ioDispatcher){
//            var OFFSET = 0L
//            if (count > 0) {
//                OFFSET = count.toLong()
//            }
//            while (true) {
//                val end = OFFSET + 9
//                val articles = supabaseClient.from("pocketarticle").select() {
//                    order("timeAdded", order = Order.DESCENDING)
//                    range(from = OFFSET, to = end)
//                }.decodeList<PocketArticle>()
//                if (articles.isEmpty()) break
//                //fetch pocketimages
//                saveData(
//                    articles.map {
//                        val images = supabaseClient.from("pocketimages").select() {
//                            filter {
//                                eq("item_id", it.itemId)
//                            }
//                        }.decodeList<PocketImages>()
//                        val videos = supabaseClient.from("pocketvideos").select() {
//                            filter {
//                                eq("item_id", it.itemId)
//                            }
//                        }.decodeList<PocketVideos>()
//                        val tags = supabaseClient.from("pockettags").select() {
//                            filter {
//                                eq("item_id", it.itemId)
//                            }
//                        }.decodeList<PocketTags>()
//                        val authors = supabaseClient.from("pocketauthors").select() {
//                            filter {
//                                eq("item_id", it.itemId)
//                            }
//                        }.decodeList<PocketAuthors>()
//                        PocketData(
//                            pocketArticle = it.copy(
//                                itemId = generateDeterministicNanoId(it.url ?: it.givenUrl ?: it.itemId),
//                                pocketId = it.itemId,
//                                resolved = 10
//                            ),
//                            pocketImages = images,
//                            pocketVideos = videos,
//                            pocketTags = tags,
//                            pocketAuthors = authors,
//                            domainMetadata = null,
//                        )
//                    }
//                )
////                if (OFFSET >= 40) break
//                OFFSET += 10
//            }
//        }
//
//    private fun provideSupabaseClient(): SupabaseClient = supabaseClient
//
//    suspend fun addArticle(article: PocketArticle): PostgrestResult {
//        return supabaseClient.from("pocketarticle").upsert(article)
//    }
//
//    suspend fun addArticles(articles: List<PocketArticle>): PostgrestResult {
//        return supabaseClient.from("pocketarticle").upsert(articles)
//    }
//
//    suspend fun getSummaryById(id: String): PostgrestResult {
//        return supabaseClient.from("pocketsummary").select() {
//            filter {
//                eq("id", id)
//            }
//        }
//    }
//
////    suspend fun observeChanges(collector: FlowCollector<List<PocketSummary>>) {
////        return summaryChanges.collect {
////            when (it) {
////                is PostgresAction.Insert -> {
////                    Timber.d("Inserted: ${it.record}")
////                    collector.emit(listOf(PocketSummary(id = it.record["id"].toString(), summary = it.record["summary"].toString())))
////                }
////
////                is PostgresAction.Delete -> Timber.d("Deleted: ${it.oldRecord}")
////                is PostgresAction.Select -> Timber.d("Selected: ${it.record}")
////                is PostgresAction.Update -> Timber.d("Updated: ${it.oldRecord} with ${it.record}")
////            }
////        }
////    }
//}
//
//@Serializable
//data class PageSnapshot(
//    val item_id: String,
//    val markdown: String,
//    val length: Int
//)