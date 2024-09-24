package com.jayteealao.trails.screens.articleList.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import com.gigamole.composeshadowsplus.common.ShadowsPlusType
import com.gigamole.composeshadowsplus.common.shadowsPlus

@Composable
fun TagItem(
    tag: String,
    modifier: Modifier = Modifier
) {
    BoxWithConstraints(
        modifier = modifier,
        contentAlignment = Alignment.TopStart
    ) {

        val tagShadowColor = getTagColor(tag)

        val height = maxHeight
        val width = maxWidth

        Box(modifier = Modifier.size(width = width, height = height))

        Text(
            text = tag,
            modifier = Modifier
                .size(width = width-4.dp, height = height-4.dp)
                .border(width = 1.dp, color = Color.Black)
                .background(Color.Black)
                .shadowsPlus(
                    type = ShadowsPlusType.SoftLayer,
                    shape = RectangleShape,
                    color = tagShadowColor,
                    offset = DpOffset(4.dp, 4.dp),
                    radius = 0.dp,
                    isAlphaContentClip = true
                )
        )
    }
}

fun getTagColor(
    tag: String
): Color {
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
    return colorsList[tag.hashCode() % colorsList.size]
}

@Preview
@Composable
private fun TagPreview() {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(width = 100.dp, height = 60.dp)
                .border(width = 1.dp, color = Color.Black)
                .background(Color.White)
                .shadowsPlus(
                    type = ShadowsPlusType.SoftLayer,
                    shape = RectangleShape,
                    color = Color.Black,
                    offset = DpOffset(4.dp, 4.dp),
                    radius = 0.dp,
//                spread = 8.dp,
                    isAlphaContentClip = true,
                )
        ) {
            Text(text = "Test")
        }
    }
}