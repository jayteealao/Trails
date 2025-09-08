package com.jayteealao.trails.screens.articleList.components

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Badge
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.text.HtmlCompat
import androidx.core.text.toSpannable
import androidx.palette.graphics.Palette
import coil3.asDrawable
import coil3.compose.AsyncImage
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import coil3.request.allowHardware
import coil3.request.crossfade
import coil3.size.Scale
import com.gigamole.composeshadowsplus.common.ShadowsPlusType
import com.gigamole.composeshadowsplus.common.shadowsPlus
import com.jayteealao.trails.common.ext.toAnnotatedString
import com.jayteealao.trails.data.models.ArticleItem
import kotlinx.coroutines.Dispatchers
import timber.log.Timber

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ArticleListItem(
    article: ArticleItem,
    modifier: Modifier = Modifier,
    onCLick: () -> Unit
) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()

    // State for palette colors
    var dominantColor by remember { mutableStateOf(Color.Transparent) }
    var vibrantColor by remember { mutableStateOf(Color.Transparent) }

    // Animated gradient angle
    val infiniteTransition = rememberInfiniteTransition(label = "gradientTransition")
    val angle by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(3000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "gradientAngle"
    )

    // Function to extract palette from bitmap
    fun extractPaletteFromBitmap(drawable: Drawable) {
//        Timber.d("converting bitmap")
        // Convert hardware bitmap to software bitmap safely
        val bitmap = when (drawable) {
            is BitmapDrawable -> drawable.bitmap
            else -> {
                val width = drawable.intrinsicWidth
                val height = drawable.intrinsicHeight
                val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                val canvas = Canvas(bitmap)
                drawable.setBounds(0, 0, canvas.width, canvas.height)
                drawable.draw(canvas)
                bitmap
            }
        }
//        Timber.d("Extracting Palette")
        Palette.Builder(bitmap).generate { palette ->
            palette?.let {

                dominantColor = Color(it.getDominantColor(Color.Transparent.toArgb()))
                vibrantColor = Color(it.getVibrantColor(Color.Transparent.toArgb()))
//                Timber.d("Dominant Color: $dominantColor")
//                Timber.d("Vibrant Color: $vibrantColor")
            }
        }
    }

    DisposableEffect(article.itemId) {
        onDispose {
            dominantColor = Color.Transparent
            vibrantColor = Color.Transparent
        }
    }


    val parsedSnippet: AnnotatedString? = if (!article.snippet.isNullOrBlank()) {
        HtmlCompat.fromHtml(
            article.snippet,
            HtmlCompat.FROM_HTML_MODE_LEGACY
        ).toSpannable().toAnnotatedString(Color.Black)
    } else { null }

    Column(modifier = modifier) {
        Row(
            modifier = Modifier
                .padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 16.dp)
                .background(Color.White)
                .heightIn(max = 150.dp)
                .clickable { onCLick() },
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top
        ) {
            Box(modifier = Modifier.wrapContentSize()
                .shadowsPlus(
                    type = ShadowsPlusType.SoftLayer,
                    shape = RoundedCornerShape(16.dp),
                    color = vibrantColor.copy(alpha = 0.6f),
                    radius = 1.dp,
                    spread = 0.dp,
                    offset = DpOffset(0.dp, 0.dp),
                    isAlphaContentClip = true
                    )
            ) {

                if (dominantColor != Color.Transparent && vibrantColor != Color.Transparent) {
                    Box(
                        modifier = Modifier
                            .height(80.dp)
                            .aspectRatio(1f)
                            .clip(RoundedCornerShape(16.dp))
                            .background(
                                brush = Brush.linearGradient(
                                    colors = listOf(
                                        dominantColor.copy(alpha = 0.6f),
                                        vibrantColor.copy(alpha = 0.6f)
                                    ),
//                                    start = Offset(
//                                        x = cos(angle * PI.toFloat() / 180) * 100,
//                                        y = sin(angle * PI.toFloat() / 180) * 100
//                                    ),
//                                    end = Offset(
//                                        x = cos((angle + 180) * PI.toFloat() / 180) * 100,
//                                        y = sin((angle + 180) * PI.toFloat() / 180) * 100
//                                    )
                                )
                            )
//                            .shadow(4.dp, RoundedCornerShape(16.dp), ambientColor = vibrantColor)
//                            .shadowsPlus()
                    )
                }

                AsyncImage(
                    modifier = Modifier
                        .height(80.dp)
                        .aspectRatio(1f)
                        .clip(RoundedCornerShape(16.dp))
                        .background(color = Color.Transparent),
                    model = ImageRequest.Builder(context)
                        .data(article.image)
                        .diskCachePolicy(CachePolicy.ENABLED)
                        .memoryCachePolicy(CachePolicy.ENABLED)
                        .diskCacheKey(article.itemId)
                        .memoryCacheKey(article.itemId)
                        .allowHardware(false)
                        .crossfade(true)
                        .coroutineContext(Dispatchers.IO)
                        .size(80, 80)
                        .scale(Scale.FILL)
                    .listener(
                        onSuccess = { _, result ->
                            Timber.d("Image Loaded")
                            extractPaletteFromBitmap(result.image.asDrawable(context.resources))
                        }
                    )
                        .build(),
                    contentDescription = null,
//                    onSuccess = { state ->
//                    Timber.d("Image Loaded")
//                        coroutineScope.launch(Dispatchers.IO) {
//                            extractPaletteFromBitmap(state.result.image.asDrawable(context.resources))
//
//                        }
//                        state.result
//                    }
//            }
                )
            }

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