package com.jayteealao.trails.ui.article

import android.annotation.SuppressLint
import android.net.Uri
import android.os.Environment
import android.webkit.WebView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.accompanist.web.AccompanistWebChromeClient
import com.google.accompanist.web.AccompanistWebViewClient
import com.google.accompanist.web.LoadingState
import com.google.accompanist.web.WebView
import com.google.accompanist.web.rememberWebViewState
import timber.log.Timber

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ArticleScreen(
    articleViewModel: ArticleViewModel,
    articleId: String
) {
    var uri by remember { mutableStateOf<Uri?>(null) }
    val pickerInitialUri = Uri.fromFile(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS))
    val article by articleViewModel.article.collectAsStateWithLifecycle()
    val webViewState = rememberWebViewState(url = "https://getpocket.com/read/${articleId}" ?: "https://www.google.com/")
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) {
        uri = it
    }
    val context = LocalContext.current

    LaunchedEffect(articleId) {
//        articleViewModel.saveWebArchive("https://getpocket.com/read/${articleId}")
    }

    val webClient: AccompanistWebViewClient = remember {
        object : AccompanistWebViewClient() {
            var urlCheck: String = ""
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                Timber.d("onPageFinished: $url")
                if (uri == null && url != null && url != urlCheck) {
//                    launcher.launch("testing.warc")
//                    urlCheck = url
                }
                Timber.d("onPageFinished: ${uri.toString()}")
            }
        }
    }

    val webChromeClient: AccompanistWebChromeClient = remember {
        object : AccompanistWebChromeClient() {

            override fun onCloseWindow(window: WebView?) {
                super.onCloseWindow(window)
//                Timber.d("onCloseWindow: ${uri.toString()}")
//                window?.saveWebArchive(uri.toString())
            }
        }
    }
    val loadingState = webViewState.loadingState
    if (loadingState is LoadingState.Loading) {
        LinearProgressIndicator(
            progress = loadingState.progress,
            modifier = Modifier
                .fillMaxWidth()
                .height(4.dp)
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
//            Timber.d("onDispose: ${pickerInitialUri.toString()}")
             //save to file in downloads
//            val file = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS).absolutePath, "${articleId}.mht")
//            it.saveWebArchive(file.path, false) {
//                Timber.d("save status $it")
//            }
        },
        client = webClient
//    LazyColumn(
//        modifier = Modifier
//            .fillMaxSize(),
//        horizontalAlignment = Alignment.CenterHorizontally,
//        verticalArrangement = Arrangement.Top,
//        contentPadding = PaddingValues(16.dp)
//    ) {
//        item {
//            Text(
//                text = article?.title ?: "Error loading article",
//                style = MaterialTheme.typography.headlineLarge,
//            )
//        }
//        item {
//            Text(
//                text = article?.url ?: "Error loading article",
//                style = MaterialTheme.typography.titleSmall,
//            )
//        }
//        item {
//            Text(
//                text = article?.text ?: "Article Text Failed to Load",
//                style = MaterialTheme.typography.bodyLarge,
//            )
//        }
    )

//    }
}

//const val CREATE_FILE = 1
//
//@RequiresApi(Build.VERSION_CODES.O)
//private fun createFile(pickerInitialUri: Uri) {
//    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
//        addCategory(Intent.CATEGORY_OPENABLE)
//        type = "application/octet-stream"
//        putExtra(Intent.EXTRA_TITLE, "article.txt")
//        putExtra(DocumentsContract.EXTRA_INITIAL_URI, pickerInitialUri)
//    }
//    startActivityForResult(intent, CREATE_FILE)
//}