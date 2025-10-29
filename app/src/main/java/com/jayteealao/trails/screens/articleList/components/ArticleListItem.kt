package com.jayteealao.trails.screens.articleList.components

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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.graphics.createBitmap
import androidx.core.text.HtmlCompat
import androidx.core.text.toSpannable
import androidx.palette.graphics.Palette
import com.jayteealao.trails.R
import com.jayteealao.trails.common.ext.toAnnotatedString
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.theme.TrailsTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
fun ArticleListItem(
    article: ArticleItem,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
    onFavoriteToggle: (Boolean) -> Unit = {},
    onTagToggle: (String, Boolean) -> Unit = { _, _ -> },
    onArchive: () -> Unit = {},
    onDelete: () -> Unit = {},
    useCardLayout: Boolean = false,
    availableTags: List<String> = emptyList(),
) {
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
    var showTagSheet by remember(article.itemId) { mutableStateOf(false) }
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
    LaunchedEffect(article.itemId, availableTags) {
        availableTags.forEach { tag ->
            if (!tagStates.containsKey(tag)) {
                tagStates[tag] = false
            }
        }
    }
    LaunchedEffect(article.itemId) {
        showTagSheet = false
        newTagText = ""
    }

    val bottomSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

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
                val bitmap = createBitmap(width, height)
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
    } else {
        null
    }
    val swipeState = rememberSwipeToDismissBoxState()

    LaunchedEffect(swipeState.currentValue) {
        when (swipeState.currentValue) {
            SwipeToDismissBoxValue.StartToEnd -> {
                val newFavorite = !isFavorite
                isFavorite = newFavorite
                onFavoriteToggle(newFavorite)
                swipeState.reset()
            }

            SwipeToDismissBoxValue.EndToStart -> {
                // Auto-reset after 5 seconds
                launch {
                    delay(5000)
                    swipeState.reset()
                }
            }

            SwipeToDismissBoxValue.Settled -> {}
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
                            .fillMaxSize()
                            .clip(RoundedCornerShape(16.dp))
                            .background(MaterialTheme.colorScheme.secondaryContainer),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            painter = painterResource(id = R.drawable.favorite_24px),
                            contentDescription = "Favorite",
                            tint = MaterialTheme.colorScheme.onSecondaryContainer
                        )
                    }
                }

                if (direction == SwipeToDismissBoxValue.EndToStart) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .align(Alignment.CenterEnd)
                            .clip(RoundedCornerShape(16.dp))
                            .background(MaterialTheme.colorScheme.surfaceVariant)
                    ) {
                        Row(
                            modifier = Modifier
                                .align(Alignment.Center)
                                .padding(horizontal = 12.dp),
                            horizontalArrangement = Arrangement.spacedBy(
                                12.dp,
                                Alignment.CenterHorizontally
                            ),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(44.dp)
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(MaterialTheme.colorScheme.surface)
                                    .clickable {
                                        onArchive()
                                        scope.launch { swipeState.reset() }
                                    },
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(
                                    painter = painterResource(id = R.drawable.archive_icon_24),
                                    contentDescription = "Archive",
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }

                            Box(
                                modifier = Modifier
                                    .size(44.dp)
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(MaterialTheme.colorScheme.surface)
                                    .clickable {
                                        onDelete()
                                        scope.launch { swipeState.reset() }
                                    },
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(
                                    painter = painterResource(id = R.drawable.delete_24px),
                                    contentDescription = "Delete",
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                }
            }
        }
    ) {
        if (useCardLayout) {

            ArticleItemCardStyle(
                article = article,
                parsedSnippet = parsedSnippet,
                tagStates = tagStates,
                onClick = onClick,
                onFavoriteToggle = { checked ->
                    isFavorite = checked
                    onFavoriteToggle(checked)
                },
                isFavorite = isFavorite,
                filledStar = filledStar,
                outlinedStar = outlinedStar,
                dominantColor = dominantColor,
                vibrantColor = vibrantColor,
                extractPaletteFromBitmap = ::extractPaletteFromBitmap,
                onTagToggle = onTagToggle,
                showAddTagDialog = { showTagSheet = true },
            )

        } else {

            ArticleItemContent( // non card item layout - legacy
                article = article,
                parsedSnippet = parsedSnippet,
                tagStates = tagStates,
                onClick = onClick,
                onFavoriteToggle = { checked ->
                    isFavorite = checked
                    onFavoriteToggle(checked)
                },
                isFavorite = isFavorite,
                filledStar = filledStar,
                outlinedStar = outlinedStar,
                dominantColor = dominantColor,
                vibrantColor = vibrantColor,
                extractPaletteFromBitmap = ::extractPaletteFromBitmap,
                onTagToggle = onTagToggle,
                showAddTagDialog = { showTagSheet = true },
                modifier = Modifier
                    .padding(start = 8.dp, end = 8.dp, top = 8.dp)
                    .background(colorScheme.surface)
                    .wrapContentHeight()
                    .clickable { onClick() },
            )
        }
        if (showTagSheet) {
            ModalBottomSheet(
                onDismissRequest = {
                    showTagSheet = false
                    newTagText = ""
                },
                sheetState = bottomSheetState,
                containerColor = MaterialTheme.colorScheme.surface,
                contentColor = MaterialTheme.colorScheme.onSurface
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 16.dp, vertical = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Text(
                        text = "Manage tags",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface
                    )

                    // Input field at the top
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        OutlinedTextField(
                            value = newTagText,
                            onValueChange = { newValue -> newTagText = newValue },
                            label = { Text(text = "New tag") },
                            modifier = Modifier.weight(1f),
                            singleLine = true,
                            colors = androidx.compose.material3.TextFieldDefaults.colors(
                                focusedTextColor = MaterialTheme.colorScheme.onSurface,
                                unfocusedTextColor = MaterialTheme.colorScheme.onSurface,
                                focusedContainerColor = MaterialTheme.colorScheme.surface,
                                unfocusedContainerColor = MaterialTheme.colorScheme.surface,
                                focusedLabelColor = MaterialTheme.colorScheme.primary,
                                unfocusedLabelColor = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        )
                        TextButton(
                            onClick = {
                                val normalizedTag = newTagText
                                    .trim()
                                    .replace(Regex("\\s+"), " ")
                                if (normalizedTag.isNotEmpty()) {
                                    val wasSelected = tagStates[normalizedTag] == true
                                    tagStates[normalizedTag] = true
                                    if (!wasSelected) {
                                        onTagToggle(normalizedTag, true)
                                    }
                                    newTagText = ""
                                }
                            }
                        ) {
                            Text(
                                text = "Add",
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                    }

                    // Selected tags section
                    val selectedTags = tagStates.filterValues { it }.keys.toList().sorted()
                    if (selectedTags.isNotEmpty()) {
                        Text(
                            text = "Selected tags",
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        FlowRow(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            selectedTags.forEach { tag ->
                                FilterChip(
                                    selected = true,
                                    onClick = {
                                        tagStates[tag] = false
                                        onTagToggle(tag, false)
                                    },
                                    label = {
                                        Text(
                                            text = tag,
                                            style = MaterialTheme.typography.labelMedium
                                        )
                                    },
                                    colors = FilterChipDefaults.filterChipColors(
                                        selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                                        selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer
                                    )
                                )
                            }
                        }
                    }

                    // Available tags section (scrollable)
                    Text(
                        text = "Available tags",
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    FlowRow(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        val availableUnselectedTags = (tagStates.keys + availableTags)
                            .toSet()
                            .filter { tagStates[it] != true }
                            .sorted()
                        availableUnselectedTags.forEach { tag ->
                            FilterChip(
                                selected = false,
                                onClick = {
                                    tagStates[tag] = true
                                    onTagToggle(tag, true)
                                },
                                label = {
                                    Text(
                                        text = tag,
                                        style = MaterialTheme.typography.labelMedium
                                    )
                                },
                                colors = FilterChipDefaults.filterChipColors(
                                    containerColor = MaterialTheme.colorScheme.surfaceVariant,
                                    labelColor = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ArticleItemCardStyle(
    article: ArticleItem,
    parsedSnippet: AnnotatedString?,
    tagStates: MutableMap<String, Boolean>,
    onClick: () -> Unit,
    onFavoriteToggle: (Boolean) -> Unit,
    isFavorite: Boolean,
    filledStar: Painter,
    outlinedStar: Painter,
    dominantColor: Color,
    vibrantColor: Color,
    extractPaletteFromBitmap: (Drawable) -> Unit,
    onTagToggle: (String, Boolean) -> Unit,
    showAddTagDialog: () -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 8.dp),
        elevation = CardDefaults.cardElevation(
            defaultElevation = 4.dp,
            pressedElevation = 8.dp
        ),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        ArticleItemContent(
            article = article,
            parsedSnippet = parsedSnippet,
            tagStates = tagStates,
            onClick = onClick,
            onFavoriteToggle = onFavoriteToggle,
            isFavorite = isFavorite,
            filledStar = filledStar,
            outlinedStar = outlinedStar,
            dominantColor = dominantColor,
            vibrantColor = vibrantColor,
            extractPaletteFromBitmap = extractPaletteFromBitmap,
            onTagToggle = onTagToggle,
            showAddTagDialog = showAddTagDialog,
            modifier = Modifier
//                .clickable { onClick() }
                .padding(12.dp)
        )

    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ArticleItemContent(
    article: ArticleItem,
    parsedSnippet: AnnotatedString?,
    tagStates: MutableMap<String, Boolean>,
    onClick: () -> Unit,
    onFavoriteToggle: (Boolean) -> Unit,
    isFavorite: Boolean,
    filledStar: Painter,
    outlinedStar: Painter,
    dominantColor: Color,
    vibrantColor: Color,
    extractPaletteFromBitmap: (Drawable) -> Unit,
    onTagToggle: (String, Boolean) -> Unit,
    showAddTagDialog: () -> Unit,
    modifier: Modifier = Modifier
) {
    val colorScheme = MaterialTheme.colorScheme
    Column(
        modifier = modifier
            .clickable { onClick() }
//            .padding(12.dp)
    ) {
        Row(
            modifier = Modifier
                .wrapContentHeight(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top
        ) {
            ArticleThumbnail(
                article = article,
                dominantColor = dominantColor,
                vibrantColor = vibrantColor,
                extractPaletteFromBitmap = extractPaletteFromBitmap,
                modifier = Modifier.align(Alignment.CenterVertically)
            )

            Spacer(modifier = Modifier.width(16.dp))
            Column(
                modifier = Modifier
                    .weight(1f)
                    .align(Alignment.CenterVertically)
            ) {
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
                        modifier = Modifier.align(Alignment.CenterVertically),
                        text = article.domain,
                        style = MaterialTheme.typography.titleSmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        fontSize = 10.sp
                    )
                    IconToggleButton(
                        modifier = Modifier.size(24.dp),
                        checked = isFavorite,
                        onCheckedChange = onFavoriteToggle
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

        Spacer(modifier = Modifier.height(8.dp))
        if (!parsedSnippet.isNullOrBlank()) {
            Text(
                text = parsedSnippet,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis
            )
        }
        TagSection(
            tagStates = tagStates,
            onTagToggle = onTagToggle,
            onAddTag = showAddTagDialog,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 4.dp)
        )
        HorizontalDivider(
            modifier = Modifier
                .background(colorScheme.surface)
                .padding(horizontal = 16.dp)
                .fillMaxWidth(),
            thickness = 1.dp,
            color = colorScheme.outlineVariant
        )
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
            onTagToggle = { _, _ -> },
            availableTags = listOf("compose", "android", "kotlin")
        )
    }
}

