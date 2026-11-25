package com.jayteealao.trails.screens.articleList.components

import android.content.res.Configuration
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.jayteealao.trails.screens.theme.TrailsTheme

/** The widths of the lines of one skeleton row, as fractions of its text column. */
private val LineWidths = listOf(0.9f, 0.6f, 0.3f)

/**
 * Still rows in the place of a list that loads: no spinner and no shimmer. Read out once as
 * "Loading articles". It scrolls, so a short window cuts off no row for good.
 */
@Composable
fun ArticleListSkeleton(modifier: Modifier = Modifier, rows: Int = 4) {
    val colors = MaterialTheme.colorScheme
    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .clearAndSetSemantics { contentDescription = "Loading articles" },
    ) {
        repeat(rows) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 16.dp, top = 16.dp, end = 16.dp, bottom = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier
                        .size(112.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(colors.surfaceVariant),
                )
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    LineWidths.forEach { width ->
                        Box(
                            Modifier
                                .fillMaxWidth(width)
                                .height(12.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(colors.surfaceVariant),
                        )
                    }
                }
            }
            HorizontalDivider(thickness = Dp.Hairline, color = colors.outlineVariant)
        }
    }
}

@Composable
private fun SkeletonPreview(darkTheme: Boolean) {
    TrailsTheme(darkTheme = darkTheme) {
        Surface(color = MaterialTheme.colorScheme.background) { ArticleListSkeleton() }
    }
}

@Preview(name = "List skeleton • light", showBackground = true, widthDp = 411, heightDp = 640)
@Composable
private fun ArticleListSkeletonLightPreview() {
    SkeletonPreview(darkTheme = false)
}

@Preview(
    name = "List skeleton • dark",
    showBackground = true,
    widthDp = 411,
    heightDp = 640,
    uiMode = Configuration.UI_MODE_NIGHT_YES,
)
@Composable
private fun ArticleListSkeletonDarkPreview() {
    SkeletonPreview(darkTheme = true)
}
