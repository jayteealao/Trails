package com.jayteealao.trails.common

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.EaseIn
import androidx.compose.animation.core.EaseInOutBack
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.BoxWithConstraintsScope
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.jayteealao.trails.screens.theme.TrailsIndigo
import com.jayteealao.trails.screens.theme.TrailsNavy
import com.jayteealao.trails.screens.theme.TrailsOcean
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/** Brand gradient for the Trails 3-diamond logo. */
val TrailsLogoGradient: Brush = Brush.linearGradient(
    colors = listOf(TrailsNavy, TrailsIndigo, TrailsOcean)
)

// ---------------------------------------------------------------------------
// Shared layout
// ---------------------------------------------------------------------------

private data class DiamondStackLayout(
    val baseSquareSize: Dp,
    val cornerRadius: Dp,
    val verticalSpacing: Dp,
    val horizontalOffset: Dp,
    val baseSquareSizePx: Float,
)

@Composable
private fun BoxWithConstraintsScope.computeDiamondLayout(): DiamondStackLayout {
    val scale = minOf(constraints.maxWidth / 150f, constraints.maxHeight / 150f)
    val density = LocalDensity.current
    return with(density) {
        DiamondStackLayout(
            baseSquareSize = (36f * scale).toDp(),
            cornerRadius = (7f * scale).toDp(),
            verticalSpacing = (30f * scale).toDp(),
            horizontalOffset = (7f * scale).toDp(),
            baseSquareSizePx = 36f * scale,
        )
    }
}

@Composable
private fun Diamond(
    layout: DiamondStackLayout,
    gradient: Brush,
    modifier: Modifier = Modifier,
    alpha: Float = 1f,
    yOffset: Dp = 0.dp,
) {
    Box(
        modifier = modifier
            .offset(x = layout.horizontalOffset, y = yOffset)
            .rotate(45f)
            .size(layout.baseSquareSize)
            .clip(RoundedCornerShape(layout.cornerRadius))
            .alpha(alpha)
            .background(gradient)
    )
}

// ---------------------------------------------------------------------------
// Static logo
// ---------------------------------------------------------------------------

@Composable
fun DrawRoundedSquares(
    modifier: Modifier = Modifier,
    gradient: Brush = TrailsLogoGradient,
) {
    BoxWithConstraints(modifier = modifier) {
        val layout = computeDiamondLayout()
        repeat(3) { index ->
            Diamond(
                layout = layout,
                gradient = gradient,
                yOffset = layout.verticalSpacing * index,
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Animated logo (loading indicator)
// ---------------------------------------------------------------------------

private class SquareAnimState(
    initialYOffset: Float,
) {
    val alpha = Animatable(0f)
    val yOffset = Animatable(initialYOffset)
}

@Composable
fun AnimatedRoundedBoxes(
    modifier: Modifier = Modifier,
    isAnimating: Boolean = true,
    gradient: Brush = TrailsLogoGradient,
) {
    BoxWithConstraints(modifier = modifier) {
        val layout = computeDiamondLayout()
        val density = LocalDensity.current

        val squares = remember(layout.baseSquareSizePx) {
            List(3) { i ->
                SquareAnimState(
                    initialYOffset = -(i + 1) * layout.baseSquareSizePx,
                )
            }
        }

        val currentIsAnimating by rememberUpdatedState(isAnimating)

        LaunchedEffect(layout.baseSquareSizePx) {
            while (true) {
                // If not animating, show static resting state and wait
                if (!currentIsAnimating) {
                    squares.forEachIndexed { i, sq ->
                        sq.alpha.snapTo(1f)
                        sq.yOffset.snapTo(i * layout.verticalSpacing.value)
                    }
                    snapshotFlow { currentIsAnimating }.first { it }
                }

                // Reset to initial state
                squares.forEachIndexed { i, sq ->
                    sq.alpha.snapTo(0f)
                    sq.yOffset.snapTo(-(i + 1) * layout.baseSquareSizePx)
                }

                // Phase 1: Drop In (staggered, top-first)
                coroutineScope {
                    squares.forEachIndexed { i, sq ->
                        launch {
                            delay(i * 300L)
                            launch {
                                sq.alpha.animateTo(1f, tween(800))
                            }
                            sq.yOffset.animateTo(
                                targetValue = i * layout.verticalSpacing.value,
                                animationSpec = tween(800, easing = EaseInOutBack),
                            )
                        }
                    }
                }

                // Phase 2: Hold
                delay(1500L)

                // Phase 3: Fall Off (staggered, bottom-first)
                val fallDistance = layout.baseSquareSizePx * 4
                coroutineScope {
                    squares.reversed().forEachIndexed { i, sq ->
                        launch {
                            delay(i * 100L)
                            launch {
                                sq.alpha.animateTo(0f, tween(300))
                            }
                            sq.yOffset.animateTo(
                                targetValue = sq.yOffset.value + fallDistance,
                                animationSpec = tween(300, easing = EaseIn),
                            )
                        }
                    }
                }

                // Phase 4: Pause
                delay(50L)
            }
        }

        // Render diamonds
        squares.forEach { sq ->
            Diamond(
                layout = layout,
                gradient = gradient,
                alpha = sq.alpha.value,
                yOffset = with(density) { sq.yOffset.value.toDp() },
            )
        }
    }
}
