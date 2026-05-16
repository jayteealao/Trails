package com.jayteealao.trails.usecases

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.os.Environment
import android.webkit.WebView
import android.webkit.WebViewClient
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.MainCoroutineDispatcher
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File
import javax.inject.Inject

class SaveWebArchiveUseCase @Inject constructor(
    @ApplicationContext private val context: Context,
    @Dispatcher(TrailsDispatchers.MAIN) private val ioDispatcher: MainCoroutineDispatcher
) {

    val scope = CoroutineScope(ioDispatcher)

    val webView = WebView(
        context,
    )

    @SuppressLint("SetJavaScriptEnabled")
    suspend operator fun invoke(url: String) {
        val urlCheck = ""
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        val file = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS).absolutePath, "test.mht")
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String?) {
                scope.launch {
                    if (url != null && url != urlCheck) {
                        delay(10000)
                        webView.saveWebArchive(
//                        context.filesDir.absolutePath + "/test.mht"
                            file.path
                        )
                    }
                }
            }
        }

        webView.loadUrl(url)
    }

}