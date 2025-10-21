package com.jayteealao.trails

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.BorderStroke
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.net.toUri
import com.jayteealao.trails.common.DrawRoundedSquares
import com.jayteealao.trails.screens.articleList.ArticleListViewModel
import com.jayteealao.trails.screens.theme.TrailsTheme
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import timber.log.Timber

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
//            Timber.d("save url called next in intent activity")
            viewModel.saveUrl(givenUrl, givenTitle)
//            Timber.d("save call complete in intent activity")
        }

        setContent {
            TrailsTheme {
                val title by viewModel.intentTitle.collectAsState()
                val url by viewModel.intentUrl.collectAsState()

                val scope = rememberCoroutineScope()
                val shouldShow by viewModel.shouldShow.collectAsState()

                LaunchedEffect(Unit) {
//                    while(shouldShow) {
//                        delay(3000)
//                    }
                    delay(8000)
//                    Timber.d("given url at intent: $url")
                    finish()
                }
                    Surface(
                        modifier = Modifier
                            .wrapContentSize(),
                        color = Color.Transparent

                    ) {
                            Dialog(
                                onDismissRequest = {
                                    scope.launch {
                                        while (shouldShow) {
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
                                        .wrapContentWidth()
                                        .widthIn(max = 400.dp)
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
                                    Row(
                                        modifier = Modifier
                                            .wrapContentHeight()
                                            .fillMaxWidth()
                                            .padding(16.dp),
                                        horizontalArrangement = Arrangement.Center,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Content(
                                            url = url,
                                            title = title
                                        )

                                    }
                                }
                            }
//                        }
                }
            }
        }
    }
}

@Composable
fun Content(
    url: String,
    title: String
) {
    Row(
        modifier = Modifier
            .wrapContentHeight(),
        horizontalArrangement = Arrangement.Start,
        verticalAlignment = Alignment.CenterVertically
    ) {
        DrawRoundedSquares(modifier = Modifier.size(64.dp))
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceAround
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                fontSize = 18.sp
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = url.toHttpUrlOrNull()?.topPrivateDomain() ?: "",
                style = MaterialTheme.typography.titleSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                fontSize = 10.sp
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