package com.jayteealao.trails.ui.pocket.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Divider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.text.HtmlCompat
import androidx.core.text.toSpannable
import com.jayteealao.trails.common.ext.toAnnotatedString
import com.jayteealao.trails.data.local.database.PocketArticle
import com.jayteealao.trails.data.local.database.PocketTuple
import java.net.URL

@Composable
fun PocketItem(
    article: PocketTuple,
    modifier: Modifier = Modifier,
    onCLick: () -> Unit
) {

    val parsedSnippet: AnnotatedString? = if (!article.snippet.isNullOrBlank()) {
        HtmlCompat.fromHtml(
            article.snippet,
            HtmlCompat.FROM_HTML_MODE_LEGACY
        ).toSpannable().toAnnotatedString(
            Color.Black)
    } else {
        null
    }
    Column(
        modifier = modifier
            .padding(
                start = 16.dp,
                end = 16.dp,
                top = 0.dp,
                bottom = 8.dp
            )
            .clickable { onCLick() }
    ) {
        Text(
            text = article.title,
            style = MaterialTheme.typography.titleMedium,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis
            )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = article.domain,
            style = MaterialTheme.typography.titleSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Spacer(modifier = Modifier.height(8.dp))
        if (!parsedSnippet.isNullOrBlank()) {
            Text(
                text = parsedSnippet,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis
            )
        }
        Spacer(modifier = Modifier.height(16.dp))
        Divider()

    }

}