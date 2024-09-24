package com.jayteealao.trails.sync.workers

import com.jayteealao.trails.data.local.database.PocketArticle
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.produce
import timber.log.Timber

@OptIn(ExperimentalCoroutinesApi::class)
fun CoroutineScope.producePocketArticleFromLocal(producer: (Int) -> List<PocketArticle>) = produce<List<PocketArticle>> {
    var offset = 0
//    while (true) {
        val articles = producer(offset)
//        if (articles.isEmpty()) {
//            Timber.d("No more articles to retrieve")
//            break
//        }
//        offset += articles.size
//        val multiplier = abs(offset - 1)
//        delay(maxOf(1000 * multiplier.toLong(), 100000))
        send(articles)
        Timber.d("Sent ${articles.size} articles")
//    }
    close()
}