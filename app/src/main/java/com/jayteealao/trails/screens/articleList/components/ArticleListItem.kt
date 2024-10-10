package com.jayteealao.trails.screens.articleList.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Badge
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.text.HtmlCompat
import androidx.core.text.toSpannable
import coil3.ImageLoader
import coil3.compose.AsyncImage
import coil3.disk.DiskCache
import coil3.memory.MemoryCache
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import coil3.request.crossfade
import coil3.size.Scale
import com.jayteealao.trails.common.ext.toAnnotatedString
import com.jayteealao.trails.data.models.ArticleItem
import kotlinx.coroutines.Dispatchers
import okio.Path.Companion.toOkioPath

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ArticleListItem(
    article: ArticleItem,
    modifier: Modifier = Modifier,
    onCLick: () -> Unit
) {
    val context = LocalContext.current

    val imageLoader = ImageLoader.Builder(context)
        .diskCache {
            DiskCache.Builder()
                .maxSizePercent(0.10) // Adjust as needed
                .directory(context.cacheDir.resolve("image_cache").toOkioPath())
                .build()
        }
        .memoryCache {
            MemoryCache.Builder()
                .maxSizePercent(context, 0.25) // Adjust as needed
                .build()
        }
        .coroutineContext(Dispatchers.IO)
        .build()

    val parsedSnippet: AnnotatedString? = if (!article.snippet.isNullOrBlank()) {
        HtmlCompat.fromHtml(
            article.snippet,
            HtmlCompat.FROM_HTML_MODE_LEGACY
        ).toSpannable().toAnnotatedString(Color.Black)
    } else { null }

    Column {
        Row(
            modifier = modifier
                .padding(start = 16.dp, end = 16.dp, top = 0.dp, bottom = 8.dp)
                .background(Color.White)
                .heightIn(max = 150.dp)
                .clickable { onCLick() },
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top
        ) {
            AsyncImage(
                modifier = Modifier
                    .height(80.dp)
                    .aspectRatio(1f)
                    .clip(RoundedCornerShape(16.dp)),
                model = ImageRequest.Builder(context)
                    .data(article.image)
                    .diskCachePolicy(CachePolicy.ENABLED)
                    .memoryCachePolicy(CachePolicy.ENABLED)
                    .diskCacheKey(article.itemId)
                    .memoryCacheKey(article.itemId)
                    .crossfade(true)
                    .coroutineContext(Dispatchers.IO)
                    .size(80, 80)
                    .scale(Scale.FILL)
                    .build(),
                imageLoader = imageLoader,
                contentDescription = null
            )
            Spacer(modifier = Modifier.width(16.dp))
            Column(
                modifier = Modifier
            ) {
                Text(
                    text = article.title,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    fontSize = 18.sp
                )
//            Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = article.domain,
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    fontSize = 10.sp
                )
                if (!parsedSnippet.isNullOrBlank()) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = parsedSnippet,
                        style = MaterialTheme.typography.bodyMedium,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis
                    )
                }
//            Spacer(modifier = Modifier.height(4.dp))
                FlowRow(
                    modifier = Modifier
                        .fillMaxWidth()
                        .wrapContentHeight(),
                    verticalArrangement = Arrangement.Center,
                    horizontalArrangement = Arrangement.Start
                ) {
                    article.tags.forEach { tag ->
                        Badge() {
                            Text(text = tag)
                        }
//                    TagItem(
//                        tag = tag,
//                        modifier = Modifier
//                            .wrapContentWidth()
//                    )
                    }
                }
            }
//        Spacer(modifier = Modifier.height(16.dp))
        }
            HorizontalDivider(
                modifier = Modifier
                    .background(Color.White)
                    .padding(horizontal = 16.dp)
                    .fillMaxWidth(),
                thickness = 1.dp,
                color = Color.Black
            )
    }

}