package com.jayteealao.trails.screens.articleList.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.jayteealao.trails.data.models.ArticleItem
import compose.icons.CssGgIcons
import compose.icons.cssggicons.Menu
import compose.icons.cssggicons.Share
import compose.icons.cssggicons.Website

@Composable
fun ArticleDialog(
    article: ArticleItem,
    showDialog: Boolean,
    onDismissRequest: () -> Unit
) {
    if (showDialog) {
        Dialog(onDismissRequest = { onDismissRequest() }) {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column {
                    Text(
                        text = article.title,
                        style = MaterialTheme.typography.titleMedium,
                        overflow = TextOverflow.Ellipsis,
                        textAlign = TextAlign.Center
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = article.domain,
                        style = MaterialTheme.typography.titleSmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Row {
                        Text(text = "2 mins")
                        Text(text = " 3600 words")
                    }
                    Text(modifier = Modifier.align(Alignment.CenterHorizontally), text = "Summary")
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = article.snippet ?: "",
                        style = MaterialTheme.typography.bodyMedium,
                        textAlign = TextAlign.Justify
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        IconButton(onClick = { /*TODO*/ }) {
                            Icon(
                                imageVector = Icons.Filled.Bookmark,
                                contentDescription = "Save article"
                            )
                        }
                        IconButton(onClick = { /*TODO*/ }) {
                            Icon(
                                imageVector = CssGgIcons.Website,
                                contentDescription = "Open in Browser"
                            )
                        }
                        IconButton(onClick = { /*TODO*/ }) {
                            Icon(imageVector = CssGgIcons.Share, contentDescription = "Share")
                        }
                        IconButton(onClick = { /*TODO*/ }) {
                            Icon(imageVector = CssGgIcons.Menu, contentDescription = "More Options")
                        }

                    }
                }
            }
        }
    }
}