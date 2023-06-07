package com.jayteealao.shared

import android.util.Log
import app.cash.zipline.EventListener
import app.cash.zipline.Zipline
import app.cash.zipline.loader.LoadResult
import app.cash.zipline.loader.ManifestVerifier
import app.cash.zipline.loader.ZiplineLoader
import kotlinx.coroutines.CoroutineDispatcher
import okhttp3.OkHttpClient
import okio.ByteString
import okio.ByteString.Companion.encodeUtf8
import okio.FileSystem
import okio.Path
import okio.Path.Companion.toPath
import java.util.logging.Logger

fun getExtractorService(zipline: Zipline): ExtractorService {
    return zipline.take("extractorService")
}

suspend fun launchZipLineJvm(dispatcher: CoroutineDispatcher): Zipline {
    val manifestUrl = "http://localhost:8080/manifest.zipline.json"
    val loader = ZiplineLoader(
        dispatcher = dispatcher,
        manifestVerifier = ManifestVerifier.NO_SIGNATURE_CHECKS,
        httpClient = OkHttpClient(),
        eventListener = object : EventListener() {
            override fun manifestParseFailed(
                applicationName: String,
                url: String?,
                exception: Exception
            ) {
//                Log.d( "", "Zipline manifestParseFailed" }
                Log.d( "Zipline Event", "Zipline manifestParseFailed" )
            }

            override fun applicationLoadFailed(
                applicationName: String,
                manifestUrl: String?,
                exception: Exception,
                startValue: Any?,
            ) {
//                Logger.d(exception) { "Zipline applicationLoadFailed" }
                Log.d( "Zipline Event", "Zipline applicationLoadFailed" )
            }

            override fun downloadFailed(
                applicationName: String,
                url: String,
                exception: Exception,
                startValue: Any?,
            ) {
//                Logger.d(exception) { "Zipline downloadFailed" }
                Log.d( "Zipline Event", "Zipline downloadFailed" )
            }
        },
        nowEpochMs = { System.currentTimeMillis() },
    )
//        .withEmbedded(
//        embeddedDir = "zipline".toPath(),
//        embeddedFileSystem = FileSystem.SYSTEM
//    )

    return when (val result = loader.loadOnce("extractor", manifestUrl)) {
        is LoadResult.Success -> result.zipline
        is LoadResult.Failure -> error(result.exception)
    }
}