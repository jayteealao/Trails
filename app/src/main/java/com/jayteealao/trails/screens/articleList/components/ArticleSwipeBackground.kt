package com.jayteealao.trails.screens.articleList.components

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SwipeToDismissBoxState
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.jayteealao.trails.R
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Data class representing a swipe action button configuration
 */
data class SwipeActionButton(
    val icon: @Composable () -> Painter,
    val contentDescription: @Composable () -> String,
    val onClick: () -> Unit
)

/**
 * Reusable swipe action button composable
 */
@Composable
private fun SwipeActionButton(
    button: SwipeActionButton,
    swipeState: SwipeToDismissBoxState,
    modifier: Modifier = Modifier
) {
    val scope = rememberCoroutineScope()

    Box(
        modifier = modifier
            .size(44.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surface)
            .clickable {
                button.onClick()
                scope.launch {
                    delay(200)
                    swipeState.reset()
                }
            },
        contentAlignment = Alignment.Center
    ) {
        Icon(
            painter = button.icon(),
            contentDescription = button.contentDescription(),
            tint = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
fun ArticleSwipeBackground(
    swipeState: SwipeToDismissBoxState,
    onArchive: () -> Unit,
    onDelete: () -> Unit,
    isFavorite: Boolean,
    isRead: Boolean,
    onReadToggle: (Boolean) -> Unit,
    markReadIcon: androidx.compose.ui.graphics.painter.Painter,
    markUnreadIcon: androidx.compose.ui.graphics.painter.Painter,
    onRegenerateDetails: () -> Unit,
    onCopyLink: () -> Unit,
    onShare: () -> Unit,
    animationTrigger: Int = 0
) {
    val direction = swipeState.dismissDirection
    val scope = rememberCoroutineScope()

    // Animation for favorite icon
    val scale = remember { Animatable(1f) }
    val rotation = remember { Animatable(0f) }

    LaunchedEffect(animationTrigger) {
        if (animationTrigger > 0) {
            // Scale up and rotate animation
            launch {
                scale.animateTo(
                    targetValue = 1.3f,
                    animationSpec = spring(
                        dampingRatio = Spring.DampingRatioMediumBouncy,
                        stiffness = Spring.StiffnessLow
                    )
                )
                scale.animateTo(
                    targetValue = 1f,
                    animationSpec = spring(
                        dampingRatio = Spring.DampingRatioMediumBouncy,
                        stiffness = Spring.StiffnessMedium
                    )
                )
            }
            launch {
                rotation.animateTo(
                    targetValue = 15f,
                    animationSpec = tween(durationMillis = 150)
                )
                rotation.animateTo(
                    targetValue = -15f,
                    animationSpec = tween(durationMillis = 150)
                )
                rotation.animateTo(
                    targetValue = 0f,
                    animationSpec = tween(durationMillis = 100)
                )
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 8.dp, vertical = 8.dp)
    ) {
        // LEFT SWIPE (StartToEnd): Favorite action background
        if (direction == SwipeToDismissBoxValue.StartToEnd) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .clip(RoundedCornerShape(16.dp))
                    .background(MaterialTheme.colorScheme.secondaryContainer),
                contentAlignment = Alignment.Center
            ) {
                // Cross-fade between filled and unfilled star
                AnimatedContent(
                    targetState = isFavorite,
                    transitionSpec = {
                        fadeIn(
                            animationSpec = tween(durationMillis = 200)
                        ) togetherWith fadeOut(
                            animationSpec = tween(durationMillis = 200)
                        )
                    },
                    label = "star_crossfade"
                ) { favorite ->
                    Icon(
                        painter = painterResource(
                            id = if (favorite) R.drawable.star_filled_24px else R.drawable.star_24px
                        ),
                        contentDescription = if (favorite) "Unfavorite" else "Favorite",
                        tint = MaterialTheme.colorScheme.onSecondaryContainer,
                        modifier = Modifier
                            .graphicsLayer(
                                scaleX = scale.value,
                                scaleY = scale.value,
                                rotationZ = rotation.value
                            )
                    )
                }
            }
        }

        // RIGHT SWIPE (EndToStart): Archive and Delete actions
        if (direction == SwipeToDismissBoxValue.EndToStart) {
            // Create list of action buttons
            val actionButtons = remember(isRead) {
                listOf(
                    SwipeActionButton(
                        icon = { if (isRead) markUnreadIcon else markReadIcon },
                        contentDescription = { if (isRead) "Mark as unread" else "Mark as read" },
                        onClick = {
                            val newReadState = !isRead
                            onReadToggle(newReadState)
                        }
                    ),
                    SwipeActionButton(
                        icon = { painterResource(id = R.drawable.archive_icon_24) },
                        contentDescription = { "Archive" },
                        onClick = onArchive
                    ),
                    SwipeActionButton(
                        icon = { painterResource(id = R.drawable.delete_24px) },
                        contentDescription = { "Delete" },
                        onClick = onDelete
                    ),
                    SwipeActionButton(
                        icon = { painterResource(id = R.drawable.refresh_24px) },
                        contentDescription = { "Regenerate details" },
                        onClick = onRegenerateDetails
                    ),
                    SwipeActionButton(
                        icon = { painterResource(id = R.drawable.link_24px) },
                        contentDescription = { "Copy link" },
                        onClick = onCopyLink
                    ),
                    SwipeActionButton(
                        icon = { painterResource(id = R.drawable.share_24px) },
                        contentDescription = { "Share" },
                        onClick = onShare
                    )
                )
            }

            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .align(Alignment.CenterEnd)
                    .clip(RoundedCornerShape(16.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Row(
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .padding(start = 12.dp, end = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(
                        12.dp,
                        Alignment.End
                    ),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    actionButtons.forEach { button ->
                        SwipeActionButton(
                            button = button,
                            swipeState = swipeState
                        )
                    }
                }
            }
        }
    }
}
