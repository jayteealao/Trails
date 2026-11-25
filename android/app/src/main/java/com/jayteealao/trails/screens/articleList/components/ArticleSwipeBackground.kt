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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.jayteealao.trails.R
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.articleList.ArticleListEvent
import com.jayteealao.trails.screens.articleList.ArticleListState
import com.jayteealao.trails.screens.articleList.ArticleListViewModel
import com.jayteealao.trails.screens.articleList.actions.ArticleAction
import com.jayteealao.trails.screens.articleList.actions.ArticleActionItem
import com.jayteealao.trails.screens.articleList.actions.articleActions
import com.jayteealao.trails.screens.articleList.actions.painter
import io.yumemi.tartlet.ViewStore
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The actions of a left swipe, in the order of its buttons. */
private val SWIPE_ACTIONS = listOf(
    ArticleAction.READ,
    ArticleAction.ARCHIVE,
    ArticleAction.DELETE,
    ArticleAction.REGENERATE,
    ArticleAction.COPY_LINK,
    ArticleAction.SHARE,
)

/**
 * Reusable swipe action button composable
 */
@Composable
private fun SwipeActionButton(
    item: ArticleActionItem,
    onClick: () -> Unit,
    swipeState: SwipeToDismissBoxState,
    modifier: Modifier = Modifier
) {
    val scope = rememberCoroutineScope()

    Box(
        modifier = modifier
            .size(44.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surface)
            .clickable(enabled = item.enabled, role = Role.Button) {
                onClick()
                scope.launch {
                    delay(200)
                    swipeState.reset()
                }
            },
        contentAlignment = Alignment.Center
    ) {
        Icon(
            painter = item.painter(),
            contentDescription = item.label,
            modifier = Modifier.alpha(if (item.enabled) 1f else 0.38f),
            tint = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
fun ArticleSwipeBackground(
    article: ArticleItem,
    swipeState: SwipeToDismissBoxState,
    animationTrigger: Int = 0,
    onAction: (ArticleAction, ArticleItem) -> Unit = { _, _ -> },
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
                    targetState = article.favorite,
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
            val actions = articleActions(article).associateBy { it.action }
            val actionButtons = SWIPE_ACTIONS.map { actions.getValue(it) }

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
                    actionButtons.forEach { item ->
                        SwipeActionButton(
                            item = item,
                            onClick = { onAction(item.action, article) },
                            swipeState = swipeState
                        )
                    }
                }
            }
        }
    }
}
