package com.jayteealao.shared

import android.util.Log
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.runBlocking
import java.util.concurrent.Executors

private fun extractArticle(extractorService: ExtractorService): ExtractData {
    Log.d("extractArticle", "extractArticle")
    return extractorService.extract()
}



fun main() {
    val executorService = Executors.newFixedThreadPool(1) {
        Thread(it, "Zipline")
    }

    val dispatcher = executorService.asCoroutineDispatcher()
    var extractData: ExtractData
    runBlocking(dispatcher) {
        val zipline = launchZipLineJvm(dispatcher)
        val extractorService = getExtractorService(zipline)
        extractData = extractArticle(extractorService)
    }
    Log.d("extractArticle", "extractData: $extractData")
//    return extractData
}

