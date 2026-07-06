package com.jayteealao.trails.screens.articleList.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import coil3.request.crossfade
import coil3.size.Scale
import com.gigamole.composeshadowsplus.common.ShadowsPlusType
import com.gigamole.composeshadowsplus.common.shadowsPlus
import com.jayteealao.trails.data.models.ArticleItem

@Composable
fun ArticleThumbnail(
    article: ArticleItem,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    androidx.compose.foundation.layout.Box(
        modifier = modifier
            .wrapContentSize()
            .shadowsPlus(
                type = ShadowsPlusType.SoftLayer,
                shape = RoundedCornerShape(16.dp),
                color = Color.Black.copy(alpha = 0.08f),
                radius = 1.dp,
                spread = 0.dp,
                offset = DpOffset(0.dp, 0.dp),
                isAlphaContentClip = true
            )
    ) {
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
                .crossfade(true)
                .size(80, 80)
                .scale(Scale.FILL)
                .build(),
            contentDescription = null,
        )
    }
}
