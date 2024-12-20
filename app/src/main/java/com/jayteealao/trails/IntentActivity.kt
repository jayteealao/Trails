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
import com.jayteealao.trails.common.DrawRoundedSquares
import com.jayteealao.trails.screens.articleList.ArticleListViewModel
import com.jayteealao.trails.screens.theme.TrailsTheme
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

@AndroidEntryPoint
class IntentActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val viewModel by viewModels<ArticleListViewModel>()
        window.setLayout(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT)

        val givenUrl: Uri? = intent?.data ?: Uri.parse(intent.getStringExtra(Intent.EXTRA_TEXT))
        val givenTitle: String? = intent.getStringExtra(Intent.EXTRA_TITLE)


        if (givenUrl != null) { viewModel.saveUrl(givenUrl, givenTitle) }
//        runBlocking() {
//            delay(5000)
//        }

        setContent {
            TrailsTheme {
                val title by viewModel.intentTitle.collectAsState()
                val url by viewModel.intentUrl.collectAsState()

                val scope = rememberCoroutineScope()
//                val shouldShow = viewModel.shouldShow.collectAsState()


                LaunchedEffect(Unit) {
                        delay(8000)
//                    }
                    finish()
                }
                    Surface(
                        modifier = Modifier
                            .wrapContentSize(),
                        color = Color.Transparent

                    ) {

//                        if (shouldShow.value){
                            Dialog(
                                onDismissRequest = {
                                    scope.launch {
//                                        viewModel.shouldShow.value = false
                                        delay(2000)
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
                                    colors = CardDefaults.cardColors().copy(
                                        containerColor = Color.White,
                                        contentColor = Color.Black
                                    ),
                                    border = CardDefaults.outlinedCardBorder().copy(
                                        brush = Brush.sweepGradient(
                                            0.0f to Color(0xFF8D50F8),
                                            0.20f to Color(0xFF673AB7),
                                            0.35f to Color(0xFF492C78),
                                            0.55f to Color(0xFF321D51),
                                            0.85f to Color(0xFF673AB7),
                                            1.0f to Color(0xFF8D50F8
                                            ),
                                        ),
                                        width = 2.dp
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
//                                        Icon(
//                                            imageVector = Tassel_App_Icon,
//                                            contentDescription = "App Icon"
//                                        )
//                                        Text(text = "Article Saved")
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
        horizontalArrangement = Arrangement.SpaceAround,
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