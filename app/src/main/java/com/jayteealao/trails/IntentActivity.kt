package com.jayteealao.trails

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.navigation.compose.hiltViewModel
import com.jayteealao.trails.common.Tassel_App_Icon
import com.jayteealao.trails.screens.articleList.ArticleListViewModel
import com.jayteealao.trails.screens.theme.TrailsTheme
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@AndroidEntryPoint
class IntentActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setLayout(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT)

        val givenUrl: Uri? = intent?.data ?: Uri.parse(intent.getStringExtra(Intent.EXTRA_TEXT))
        val givenTitle: String? = intent.getStringExtra(Intent.EXTRA_TITLE)

        setContent {
            TrailsTheme {
                val scope = rememberCoroutineScope()

                val viewModel: ArticleListViewModel = hiltViewModel<ArticleListViewModel>()

                LaunchedEffect(Unit) {
                    if (givenUrl != null) {
                        viewModel.saveUrl(givenUrl, givenTitle)
                    }
                    delay(5000)
                    finish()
                }
                    Surface(
                        modifier = Modifier
                            .fillMaxSize(),
                        color = Color.Transparent

                    ) {

                        Dialog( onDismissRequest = {
                            scope.launch {
                                delay(2000)
                                finish()
                            }
                        },
                            properties = DialogProperties(
                                dismissOnBackPress = true,
                                dismissOnClickOutside = true
                            )
                        ) {

                            Card(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .wrapContentHeight(),
                                colors = CardDefaults.cardColors().copy(
                                    containerColor = Color.White,
                                    contentColor = Color.Black
                                )
                            ) {
                               Row(
                                   modifier =Modifier.wrapContentHeight()
                                       .fillMaxWidth()
                                       .padding(16.dp),
                                   horizontalArrangement = Arrangement.Center,
                                   verticalAlignment = Alignment.CenterVertically
                               ) {
                                   Icon(imageVector = Tassel_App_Icon, contentDescription = "App Icon")
                                   Text(text = "Article Saved")
                               }
                            }
                        }
                }
            }
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