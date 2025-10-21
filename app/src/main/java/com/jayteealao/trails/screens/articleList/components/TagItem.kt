package com.jayteealao.trails.screens.articleList.components

import android.annotation.SuppressLint
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.gigamole.composeshadowsplus.common.ShadowsPlusType
import com.gigamole.composeshadowsplus.common.shadowsPlus
import com.jayteealao.trails.screens.theme.TrailsTheme
import kotlin.math.abs

@SuppressLint("UnusedBoxWithConstraintsScope")
@Composable
fun TagItem(
    tag: String,
    modifier: Modifier = Modifier
) {
    val colorScheme = MaterialTheme.colorScheme
    val tagShadowColor = rememberTagColor(tag = tag)

    Text(
        text = tag,
        color = colorScheme.onSurface,
        modifier = modifier
            .wrapContentWidth()
            .wrapContentHeight()
            .border(width = 1.dp, color = colorScheme.outlineVariant, shape = RectangleShape)
            .background(colorScheme.surface, RectangleShape)
            .shadowsPlus(
                type = ShadowsPlusType.SoftLayer,
                shape = RectangleShape,
                color = tagShadowColor,
                offset = DpOffset(4.dp, 4.dp),
                radius = 0.dp,
                isAlphaContentClip = true
            )
            .padding(horizontal = 8.dp, vertical = 2.dp),
        fontSize = 12.sp
    )
}

@Composable
private fun rememberTagColor(tag: String): Color {
    val colorScheme = MaterialTheme.colorScheme
    val colorsList = remember(colorScheme) {
        listOf(
            colorScheme.primary,
            colorScheme.secondary,
            colorScheme.tertiary,
            colorScheme.primaryContainer,
            colorScheme.secondaryContainer,
            colorScheme.tertiaryContainer,
            colorScheme.surfaceTint,
        )
    }
    return remember(tag, colorsList) { colorsList[abs(tag.hashCode()) % colorsList.size] }
}

@Preview
@Composable
private fun TagPreview() {
    TrailsTheme {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(width = 100.dp, height = 60.dp)
                    .border(
                        width = 1.dp,
                        color = MaterialTheme.colorScheme.outlineVariant,
                        shape = RectangleShape
                    )
                    .background(MaterialTheme.colorScheme.surface, RectangleShape)
                    .shadowsPlus(
                        type = ShadowsPlusType.SoftLayer,
                        shape = RectangleShape,
                        color = MaterialTheme.colorScheme.primary,
                        offset = DpOffset(4.dp, 4.dp),
                        radius = 0.dp,
                        isAlphaContentClip = true,
                    )
            ) {
                Text(text = "Test", color = MaterialTheme.colorScheme.onSurface)
            }
        }
    }
}