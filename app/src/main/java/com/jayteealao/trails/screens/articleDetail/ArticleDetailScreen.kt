@file:OptIn(ExperimentalMaterial3Api::class)

package com.jayteealao.trails.screens.articleDetail

import android.annotation.SuppressLint
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.constraintlayout.compose.ConstraintLayout
import com.google.accompanist.web.AccompanistWebViewClient
import com.google.accompanist.web.LoadingState
import com.google.accompanist.web.WebView
import com.google.accompanist.web.rememberWebViewState
import com.jayteealao.trails.data.local.database.PocketArticle
import com.mikepenz.markdown.coil3.Coil3ImageTransformerImpl
import com.mikepenz.markdown.compose.Markdown
import com.mikepenz.markdown.m3.markdownColor
import com.mikepenz.markdown.m3.markdownTypography
import com.mikepenz.markdown.model.markdownPadding
import compose.icons.CssGgIcons
import compose.icons.cssggicons.AlignMiddle
import compose.icons.cssggicons.Browser
import compose.icons.cssggicons.Pocket

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ArticleDetailScreen(
    article: PocketArticle
) {
    var selectedTabIndex by remember { mutableIntStateOf(0) }

    ConstraintLayout(
    ) {
        val (tabRow, detailView) = createRefs()

        ArticleDetails(
            modifier = Modifier.constrainAs(detailView) {
                top.linkTo(parent.top)
                bottom.linkTo(tabRow.top)
                start.linkTo(parent.start)
                end.linkTo(parent.end)
            },
            selectedTabIndex = selectedTabIndex,
            article = article
        )

        ArticleDetailTabRow(
            modifier = Modifier.constrainAs(tabRow) {
//                top.linkTo(detailView.bottom)
                bottom.linkTo(parent.bottom)
                start.linkTo(parent.start)
                end.linkTo(parent.end)
            },
            selectedTabIndex = selectedTabIndex,
            onTabSelected = {
                selectedTabIndex = it
            }
        )

    }
}

@Composable
fun ArticleDetailTabRow(
    modifier: Modifier = Modifier,
    selectedTabIndex: Int = 2,
    onTabSelected: (Int) -> Unit = {}
) {
    PrimaryTabRow(
        selectedTabIndex = selectedTabIndex,
        modifier = modifier
    ) {
//        Tab
        Tab(
            selected = selectedTabIndex == 0,
            onClick = { onTabSelected(0) },
            icon = {
                Icon(CssGgIcons.AlignMiddle, contentDescription = null)
            }
        )

        Tab(
            selected = selectedTabIndex == 1,
            onClick = { onTabSelected(1) },
            icon = {
                Icon(CssGgIcons.Pocket, contentDescription = null)
            }
        )

        Tab(
            selected = selectedTabIndex == 2,
            onClick = { onTabSelected(2) },
            icon = {
                Icon(CssGgIcons.Browser, contentDescription = null)
            }
        )
    }
}

@Composable
fun ArticleDetails(
    modifier: Modifier = Modifier,
    selectedTabIndex: Int = 0,
    article: PocketArticle
) {
    AnimatedContent(
        targetState = selectedTabIndex,
        modifier = modifier
    ) { targetIndex ->
        when (targetIndex) {
            0 -> ArticleMarkdown(article.text ?: "No content")
            1 -> ArticlePocketWebView(article.itemId)
            2 -> ArticleWebView(article.url ?: article.givenUrl ?: "https://www.google.com/")

        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ArticleWebView(
    url: String,
    modifier: Modifier = Modifier,
) {
    val webViewState = rememberWebViewState(url = url)
    val webClient: AccompanistWebViewClient = remember {
        object : AccompanistWebViewClient() {
        }
    }

    WebView(
        state = webViewState,
        modifier = modifier,
        onCreated = {
            it.settings.javaScriptEnabled = true
            it.settings.domStorageEnabled = true
        },
        onDispose = {
        },
        client = webClient
    )
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ArticlePocketWebView(
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

@Composable
fun ArticleMarkdown(
    content: String,
    modifier: Modifier = Modifier
) {
    val scrollState = rememberScrollState()
    Markdown(
        content = content,
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(scrollState),
        colors = markdownColor(),
        typography = markdownTypography(),
        imageTransformer = Coil3ImageTransformerImpl,
        padding = markdownPadding(block = 4.dp)
    )
}