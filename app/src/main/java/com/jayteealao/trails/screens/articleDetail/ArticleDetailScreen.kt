package com.jayteealao.trails.screens.articleDetail

import android.annotation.SuppressLint
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.google.accompanist.web.AccompanistWebViewClient
import com.google.accompanist.web.LoadingState
import com.google.accompanist.web.WebView
import com.google.accompanist.web.rememberWebViewState

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ArticleDetailScreen(
    articleId: String
) {
    val webViewState = rememberWebViewState(url = "https://getpocket.com/read/${articleId}" ?: "https://www.google.com/")

    val webClient: AccompanistWebViewClient = remember {
        object : AccompanistWebViewClient() {
        }
    }

    val loadingState = webViewState.loadingState
    Column {
        if (loadingState is LoadingState.Loading) {
            LinearProgressIndicator(
                progress = { loadingState.progress },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(4.dp),
            )
        }
        WebView(
            state = webViewState,
            modifier = Modifier
                .fillMaxWidth()
                .fillMaxHeight(),
            onCreated = {
                it.settings.javaScriptEnabled = true
                it.settings.domStorageEnabled = true
            },
            onDispose = {
            },
            client = webClient
        )
    }
}
