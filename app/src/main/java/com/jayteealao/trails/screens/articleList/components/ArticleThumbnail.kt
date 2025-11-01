package com.jayteealao.trails.screens.articleList.components

import android.graphics.drawable.Drawable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import coil3.asDrawable
import coil3.compose.AsyncImage
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import coil3.request.allowHardware
import coil3.request.crossfade
import coil3.size.Scale
import com.gigamole.composeshadowsplus.common.ShadowsPlusType
import com.gigamole.composeshadowsplus.common.shadowsPlus
import com.jayteealao.trails.common.extractPaletteFromBitmap
import com.jayteealao.trails.data.models.ArticleItem
import kotlinx.coroutines.Dispatchers
import timber.log.Timber

@Composable
fun ArticleThumbnail(
    article: ArticleItem,
    dominantColor: Color,
    vibrantColor: Color,
    onPaletteExtracted: (Color, Color) -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    Box(
        modifier = modifier
            .wrapContentSize()
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
                        )
                    )
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
                        extractPaletteFromBitmap(
                            drawable = result.image.asDrawable(context.resources),
                            onColorsExtracted = onPaletteExtracted
                        )
                    }
                )
                .build(),
            contentDescription = null,
        )
    }
}