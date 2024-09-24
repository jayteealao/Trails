package com.jayteealao.trails.services.supabase

import com.jayteealao.trails.data.local.database.PocketArticle
import com.jayteealao.trails.data.models.PocketSummary
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.postgrest.PropertyConversionMethod
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.result.PostgrestResult
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.Realtime
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import kotlinx.coroutines.flow.FlowCollector
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SupabaseService @Inject constructor() {

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
        supabaseClient.channel("pocketSummaryChannel")
    }

    val summaryChanges = summaryChannel.postgresChangeFlow<PostgresAction>(schema = "public") {
            table = "pocketsummary"
        }

    private fun provideSupabaseClient(): SupabaseClient = supabaseClient

    suspend fun addArticle(article: PocketArticle): PostgrestResult {
        return supabaseClient.from("pocketarticle").upsert(article)
    }

    suspend fun addArticles(articles: List<PocketArticle>): PostgrestResult {
        return supabaseClient.from("pocketarticle").upsert(articles)
    }

    suspend fun getSummaryById(id: String): PostgrestResult {
        return supabaseClient.from("pocketsummary").select() {
            filter {
                eq("id", id)
            }
        }
    }

    suspend fun observeChanges(collector: FlowCollector<List<PocketSummary>>) {
        return summaryChanges.collect {
            when (it) {
                is PostgresAction.Insert -> {
                    Timber.d("Inserted: ${it.record}")
                    collector.emit(listOf(PocketSummary(id = it.record["id"].toString(), summary = it.record["summary"].toString())))
                }

                is PostgresAction.Delete -> Timber.d("Deleted: ${it.oldRecord}")
                is PostgresAction.Select -> Timber.d("Selected: ${it.record}")
                is PostgresAction.Update -> Timber.d("Updated: ${it.oldRecord} with ${it.record}")
            }
        }
    }
}