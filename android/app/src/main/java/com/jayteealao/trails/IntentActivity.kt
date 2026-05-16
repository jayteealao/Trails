package com.jayteealao.trails

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.BorderStroke
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.net.toUri
import com.jayteealao.trails.common.AnimatedRoundedBoxes
import com.jayteealao.trails.screens.articleList.ArticleListViewModel
import com.jayteealao.trails.screens.theme.TrailsTheme
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

@AndroidEntryPoint
class IntentActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val viewModel by viewModels<ArticleListViewModel>()
        window.setLayout(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT)

        val givenUrl: Uri? = intent?.data ?: intent.getStringExtra(Intent.EXTRA_TEXT)?.toUri()
        val givenTitle: String? = intent.getStringExtra(Intent.EXTRA_TITLE)


        if (givenUrl != null) {
            viewModel.saveUrl(givenUrl, givenTitle)
        }

        setContent {
            TrailsTheme {
                val title by viewModel.intentTitle.collectAsState()
                val url by viewModel.intentUrl.collectAsState()
                val savedArticleId by viewModel.savedArticleId.collectAsState()

                val scope = rememberCoroutineScope()
                val isSaving by viewModel.isSaving.collectAsState()
                val snackbarHostState = remember { SnackbarHostState() }

                // Show undo snackbar when article is saved
                LaunchedEffect(savedArticleId) {
                    savedArticleId?.let { articleId ->
                        val result = snackbarHostState.showSnackbar(
                            message = "Article saved",
                            actionLabel = "Undo",
                            withDismissAction = true
                        )

                        if (result == SnackbarResult.ActionPerformed) {
                            // User clicked undo, delete the article
                            viewModel.deleteArticle(articleId)
                        }
                    }
                }

                LaunchedEffect(Unit) {
                    // Wait for save to complete (max 15s), then give user time to interact with undo snackbar
                    withTimeoutOrNull(15_000L) {
                        viewModel.isSaving.first { !it }
                    }
                    delay(5000)
                    finish()
                }

                Box(modifier = Modifier.fillMaxSize()) {
                    Surface(
                        modifier = Modifier
                            .wrapContentSize(),
                        color = Color.Transparent

                    ) {
                            Dialog(
                                onDismissRequest = {
                                    scope.launch {
                                        while (isSaving) {
                                            delay(1000)
                                        }
                                        delay(1000)
                                        finish()
                                    }
                                },
                                properties = DialogProperties(
                                    dismissOnBackPress = true,
                                    dismissOnClickOutside = true,
                                    usePlatformDefaultWidth = true
                                )
                            ) {

                                Card(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .wrapContentHeight(),
                                    colors = CardDefaults.cardColors(
                                        containerColor = MaterialTheme.colorScheme.surface,
                                        contentColor = MaterialTheme.colorScheme.onSurface
                                    ),
                                    border = BorderStroke(
                                        width = 2.dp,
                                        brush = Brush.sweepGradient(
                                            0.0f to MaterialTheme.colorScheme.primary,
                                            0.33f to MaterialTheme.colorScheme.primaryContainer,
                                            0.66f to MaterialTheme.colorScheme.secondary,
                                            1.0f to MaterialTheme.colorScheme.primary,
                                        )
                                    )
                                ) {
                                    Content(
                                        url = url,
                                        title = title,
                                        isSaving = isSaving,
                                        modifier = Modifier.padding(16.dp),
                                    )
                                }
                            }
                    }

                    // SnackbarHost at the bottom of the Box
                    SnackbarHost(
                        hostState = snackbarHostState,
                        modifier = Modifier.align(Alignment.BottomCenter)
                    )
                }
            }
        }
    }
}

@Composable
fun Content(
    url: String,
    title: String,
    isSaving: Boolean = false,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AnimatedRoundedBoxes(
            modifier = Modifier.size(56.dp),
            isAnimating = isSaving,
        )
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(modifier = Modifier.height(2.dp))
            Text(
                text = url.toHttpUrlOrNull()?.topPrivateDomain() ?: "",
                style = MaterialTheme.typography.bodySmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
fun Greeting(name: String, modifier: Modifier = Modifier) {
    Text(
        text = "Hello $name!",
        modifier = modifier
    )
}

@Preview(showBackground = true)
@Composable
fun GreetingPreview() {
    TrailsTheme {
        Greeting("Android")
    }
}