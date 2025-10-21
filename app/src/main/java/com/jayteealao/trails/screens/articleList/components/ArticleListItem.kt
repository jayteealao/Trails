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
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
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
import com.jayteealao.trails.R
import com.jayteealao.trails.common.ext.toAnnotatedString
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.theme.TrailsTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import timber.log.Timber

@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
fun ArticleListItem(
    article: ArticleItem,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
    onFavoriteToggle: (Boolean) -> Unit = {},
    onTagToggle: (String, Boolean) -> Unit = { _, _ -> },
    onArchive: () -> Unit = {},
    onDelete: () -> Unit = {}
) {
    val context = LocalContext.current

    // State for palette colors
    var dominantColor by remember { mutableStateOf(Color.Transparent) }
    var vibrantColor by remember { mutableStateOf(Color.Transparent) }

    var isFavorite by remember(article.itemId) { mutableStateOf(article.favorite) }
    LaunchedEffect(article.favorite) {
        isFavorite = article.favorite
    }

    val filledStar = painterResource(id = R.drawable.star_filled_24px)
    val outlinedStar = painterResource(id = R.drawable.star_24px)

    val tagStates = remember(article.itemId) { mutableStateMapOf<String, Boolean>() }
    var showAddTagDialog by remember(article.itemId) { mutableStateOf(false) }
    var newTagText by remember(article.itemId) { mutableStateOf("") }
    LaunchedEffect(article.tagsString) {
        // Mark all known tags as absent until confirmed by the latest data snapshot
        tagStates.keys.toList().forEach { key ->
            tagStates[key] = false
        }
        article.tags.forEach { tag ->
            tagStates[tag] = true
        }
    }
    LaunchedEffect(article.itemId) {
        showAddTagDialog = false
        newTagText = ""
    }

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


    val colorScheme = MaterialTheme.colorScheme
    val parsedSnippet: AnnotatedString? = if (!article.snippet.isNullOrBlank()) {
        HtmlCompat.fromHtml(
            article.snippet,
            HtmlCompat.FROM_HTML_MODE_LEGACY
        ).toSpannable().toAnnotatedString(colorScheme.onSurface)
    } else { null }
    val swipeState = rememberSwipeToDismissBoxState()
    var showTrailingActions by remember(article.itemId) { mutableStateOf(false) }

    LaunchedEffect(swipeState.currentValue) {
        when (swipeState.currentValue) {
            SwipeToDismissBoxValue.StartToEnd -> {
                val newFavorite = !isFavorite
                isFavorite = newFavorite
                onFavoriteToggle(newFavorite)
                swipeState.reset()
            }
            SwipeToDismissBoxValue.EndToStart -> {
                showTrailingActions = true
            }
            SwipeToDismissBoxValue.Settled -> {
                showTrailingActions = false
            }
        }
    }

    SwipeToDismissBox(
        modifier = modifier,
        state = swipeState,
        backgroundContent = {
            val direction = swipeState.dismissDirection
            val scope = rememberCoroutineScope()
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 8.dp, vertical = 8.dp)
            ) {
                if (direction == SwipeToDismissBoxValue.StartToEnd) {
                    Box(
                        modifier = Modifier
                            .fillMaxHeight()
                            .align(Alignment.CenterStart)
                            .clip(RoundedCornerShape(16.dp))
                            .background(Color.Blue)
                            .padding(horizontal = 16.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            painter = painterResource(id = R.drawable.favorite_24px),
                            contentDescription = "Favorite",
                            tint = Color.White
                        )
                    }
                }

                if (showTrailingActions) {
                    Row(
                        modifier = Modifier
                            .fillMaxHeight()
                            .align(Alignment.CenterEnd)
                            .clip(RoundedCornerShape(16.dp))
                            .background(MaterialTheme.colorScheme.surfaceVariant)
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier
                                .size(44.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(Color.Green)
                                .clickable {
                                    onArchive()
                                    showTrailingActions = false
                                    scope.launch { swipeState.reset() }
                                },
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                painter = painterResource(id = R.drawable.archive_icon_24),
                                contentDescription = "Archive",
                                tint = Color.White
                            )
                        }

                        Box(
                            modifier = Modifier
                                .size(44.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(Color.Red)
                                .clickable {
                                    onDelete()
                                    showTrailingActions = false
                                    scope.launch { swipeState.reset() }
                                },
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                painter = painterResource(id = R.drawable.delete_24px),
                                contentDescription = "Delete",
                                tint = Color.White
                            )
                        }
                    }
                }
            }
        }
    ) {
        Column {
            Row(
                modifier = Modifier
                    .padding(start = 8.dp, end = 8.dp, top = 8.dp)
                    .background(colorScheme.surface)
                    .wrapContentHeight()
//                    .heightIn(max = 90.dp)
                    .clickable { onClick() },
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top
            ) {
                Box(
                    modifier = Modifier
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
                        .align(Alignment.CenterVertically)
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
                                    extractPaletteFromBitmap(result.image.asDrawable(context.resources))
                                }
                            )
                            .build(),
                        contentDescription = null,
                    )
                }

                Spacer(modifier = Modifier.width(16.dp))
                Column (
                    modifier = Modifier
                        .weight(1f)
                        .align(Alignment.CenterVertically)){
                    Text(
                        modifier = Modifier
                            .wrapContentHeight()
                            .padding(end = 8.dp),
                        text = article.title,
                        style = MaterialTheme.typography.titleMedium,
                        fontSize = 16.sp
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            modifier = Modifier
                                .padding(start = 0.dp)
                                .align(Alignment.CenterVertically),
                            text = article.domain,
                            style = MaterialTheme.typography.titleSmall,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            fontSize = 10.sp
                        )
                        IconToggleButton(
                            modifier = Modifier.size(24.dp),
                            checked = isFavorite,
                            onCheckedChange = { checked ->
                                isFavorite = checked
                                onFavoriteToggle(checked)
                            }
                        ) {
                            Icon(
                                painter = if (isFavorite) filledStar else outlinedStar,
                                contentDescription = if (isFavorite) {
                                    "Remove from favorites"
                                } else {
                                    "Add to favorites"
                                },
                                tint = if (isFavorite) {
                                    MaterialTheme.colorScheme.primary
                                } else {
                                    MaterialTheme.colorScheme.onSurfaceVariant
                                }
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(4.dp))
            if (!parsedSnippet.isNullOrBlank()) {
//                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    modifier = Modifier.padding(start = 8.dp, end = 8.dp),
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
                    .wrapContentHeight()
                    .padding(start = 8.dp, end = 4.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                val tagsInDisplay = tagStates.keys.toList().sorted()
                tagsInDisplay.forEach { tag ->
                    val selected = tagStates[tag] ?: false
                    FilterChip(
                        selected = selected,
                        onClick = {
                            val newSelected = !selected
                            tagStates[tag] = newSelected
                            onTagToggle(tag, newSelected)
                        },
                        label = {
                            Text(modifier = Modifier, text = tag, style = MaterialTheme.typography.labelSmall)
//                            TagItem(tag = tag)
                                },
                        modifier = Modifier
                            .height(28.dp)
                            .padding(bottom = 8.dp),
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = MaterialTheme.colorScheme.primary.copy(
                                alpha = 0.16f
                            ),
                            selectedLabelColor = MaterialTheme.colorScheme.primary
                        )
                    )
                }
                FilterChip(
                    selected = false,
                    onClick = { showAddTagDialog = true },
                    label = { Text(text = "") },
                    leadingIcon = {
                        Icon(
                            imageVector = Icons.Filled.Add,
                            contentDescription = "Add tag",
                            modifier = Modifier
                                .size(20.dp)
                                .wrapContentHeight()
                        )
                    },
                    modifier = Modifier
                        .height(28.dp)
                        .padding(bottom = 8.dp)
                        .align(Alignment.Top),
                    border = FilterChipDefaults.filterChipBorder(
                        borderColor = Color.Transparent,
                        selectedBorderColor = Color.Transparent,
                        disabledBorderColor = Color.Transparent,
                        disabledSelectedBorderColor = Color.Transparent,
                        enabled = true,
                        selected = false
                    ),
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = Color.Transparent,
                        selectedLabelColor = Color.Transparent
                    )
                )
            }
            HorizontalDivider(
                modifier = Modifier
                    .background(colorScheme.surface)
                    .padding(horizontal = 16.dp)
                    .fillMaxWidth(),
                thickness = 1.dp,
                color = colorScheme.outlineVariant
            )
        }

        if (showAddTagDialog) {
            AlertDialog(
                onDismissRequest = {
                    showAddTagDialog = false
                    newTagText = ""
                },
                title = { Text(text = "Add tag") },
                text = {
                    OutlinedTextField(
                        value = newTagText,
                        onValueChange = { newValue -> newTagText = newValue },
                        label = { Text(text = "Tag name") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                },
                confirmButton = {
                    TextButton(
                        onClick = {
                            val normalizedTag = newTagText.trim().replace(Regex("\\s+"), " ")
                            if (normalizedTag.isNotEmpty()) {
                                val alreadyEnabled = tagStates[normalizedTag] == true
                                tagStates[normalizedTag] = true
                                if (!alreadyEnabled) {
                                    onTagToggle(normalizedTag, true)
                                }
                            }
                            newTagText = ""
                            showAddTagDialog = false
                        }
                    ) {
                        Text(text = "Add")
                    }
                },
                dismissButton = {
                    TextButton(
                        onClick = {
                            showAddTagDialog = false
                            newTagText = ""
                        }
                    ) {
                        Text(text = "Cancel")
                    }
                }
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Preview
@Composable
fun ArticleListItemPreview() {
    val article = ArticleItem(
        itemId = "123",
        title = "A long and interesting article title that might wrap to two lines",
        url = "https://example.com/article",
        image = "https://picsum.photos/80/80",
        favorite = true,
        tagsString = "android,jetpack,compose",
        snippet = "This is a short snippet of the article content. It provides a brief overview of what the article is about. <b>Bold text</b> is also supported."
    )
    TrailsTheme {
        ArticleListItem(
            article = article,
            onClick = {},
            onFavoriteToggle = {},
            onTagToggle = { _, _ -> }
        )
    }
}

