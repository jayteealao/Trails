package com.jayteealao.trails.screens.articleList.components

import android.annotation.SuppressLint
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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

    Box(
        modifier = Modifier
            .wrapContentSize()
            .padding(0.dp, 0.dp)
            .border(width = 1.dp, color = colorScheme.outlineVariant, shape = RectangleShape)
            .dropShadow(
                shape = RectangleShape,
                shadow = Shadow(
                    color = tagShadowColor,
                    offset = DpOffset(2.dp, 2.dp),
                    radius = 0.dp,
                    spread = 0.dp
                )
            )
            .background(colorScheme.surface, RectangleShape)
    ) {
        Text(
            text = tag,
            color = colorScheme.onSurface,
            modifier = modifier
                .padding(horizontal = 1.dp, vertical = 1.dp)
                .background(colorScheme.surface, RectangleShape),
            fontSize = 12.sp
        )
    }
    Box(
        modifier = Modifier
            .wrapContentSize()
            .padding(0.dp, 0.dp)
            .border(width = 1.dp, color = Color.Black)
            .dropShadow(
                shape = RectangleShape,
                shadow = Shadow(
                    color = tagShadowColor,
                    offset = DpOffset(2.dp, 2.dp),
                    radius = 0.dp,
                    spread = 0.dp
                )
            )
            .background(Color.White)
    ) {
        Text(
            text = tag,
            modifier = modifier
//                .border(width = 1.dp, color = Color.Black)
                .padding(1.dp, 1.dp)
//                .wrapContentHeight()

                .background(Color.White),
            style = MaterialTheme.typography.labelSmall,
        )
    }
}

@Composable
private fun rememberTagColor(tag: String): Color {
    val colorsList = listOf(
            Color.Black,
            Color.Blue,
            Color.White,
            Color.Yellow,
            Color(0xFF0000FF),
            Color(0xFF00FF00),
            Color(0xFFFF0000),
            Color(0xFF00FFFF),
            Color(0xFF800080),
            Color(0xFFFF00FF),
            Color(0xFF008080),
            Color(0xFF808000),
            Color(0xFF008000),
            Color(0xFF800000),
            Color(0xFF000080),
            Color(0xFFC0C0C0),
            Color(0xFF808080),
            Color(0xFFA0522D),
            Color(0xFFA52A2A),
            Color(0xFF800000),
        )
    return remember(tag, colorsList) { colorsList[abs(tag.hashCode()) % colorsList.size] }
}

@Preview
@Composable
private fun TagPreview() {

    TrailsTheme {
        FlowRow(
            modifier = Modifier
                .padding(4.dp)
        ) { TagItem(tag = "Sample") }
    }
}