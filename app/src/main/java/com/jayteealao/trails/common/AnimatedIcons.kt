package com.jayteealao.trails.common

import android.annotation.SuppressLint
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.EaseInOutBack
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@SuppressLint("UnusedBoxWithConstraintsScope")
@Composable
fun AnimatedRoundedBoxes(
    modifier: Modifier = Modifier,
    isAnimating: Boolean = true,
    animationDuration: Int = 4000,
    pauseDuration: Long = 1000
) {
    BoxWithConstraints(modifier = modifier.background(Color.White)) {
        val scale = minOf(
            constraints.maxWidth / 150f,
            constraints.maxHeight / 150f
        )

        // Convert scale factor to dp
        val density = LocalDensity.current
        val baseSquareSize = with(density) { (36f * scale).toDp() }
        val cornerRadius = with(density) { (7f * scale).toDp() }
        val horizontalOffset = with(density) { (7f * scale).toDp() }

        // Animation states for each square
        val square1YOffset = remember { Animatable(-baseSquareSize.value) }
        val square2YOffset = remember { Animatable(-baseSquareSize.value * 2) }
        val square3YOffset = remember { Animatable(-baseSquareSize.value * 3) }

        // Initial appearance alpha animations
        val square1InitialAlpha = remember { Animatable(1f) }
        val square2InitialAlpha = remember { Animatable(1f) }
        val square3InitialAlpha = remember { Animatable(1f) }

        // Falling and flying animations
        val square1FallOffset = remember { Animatable(0f) }
        val square2FallOffset = remember { Animatable(0f) }
        val square3FallOffset = remember { Animatable(0f) }

        // Alpha for disappearing
        val square1DisappearAlpha = remember { Animatable(1f) }
        val square2DisappearAlpha = remember { Animatable(1f) }
        val square3DisappearAlpha = remember { Animatable(1f) }

        LaunchedEffect(isAnimating) {
            if (!isAnimating) {
                // Reset animations
                listOf(
                    square1YOffset, square2YOffset, square3YOffset,
                    square1FallOffset, square2FallOffset, square3FallOffset,
                    square1InitialAlpha, square2InitialAlpha, square3InitialAlpha,
                    square1DisappearAlpha, square2DisappearAlpha, square3DisappearAlpha
                ).forEach { it.snapTo(0f) }
                return@LaunchedEffect
            }

            while(isAnimating) {
                // Initial drop animations
                launch {
                    // First square
                    square1InitialAlpha.animateTo(
                        targetValue = 0f,
                        animationSpec = tween(400)
                    )
                    square1YOffset.animateTo(
                        targetValue = 0f,
                        animationSpec = tween(800, easing = EaseInOutBack)
                    )

                    delay(200)
                    // Second square
                    square2InitialAlpha.animateTo(
                        targetValue = 0f,
                        animationSpec = tween(400)
                    )
                    square2YOffset.animateTo(
                        targetValue = baseSquareSize.value,
                        animationSpec = tween(800, easing = EaseInOutBack)
                    )

                    delay(200)
                    // Third square
                    square3InitialAlpha.animateTo(
                        targetValue = 0f,
                        animationSpec = tween(400)
                    )
                    square3YOffset.animateTo(
                        targetValue = baseSquareSize.value * 2,
                        animationSpec = tween(800, easing = EaseInOutBack)
                    )
                }

                    delay(2000)

// Fall and disappear animations
//                launch {
//                     //First square
//                    square1FallOffset.animateTo(
//                        targetValue = baseSquareSize.value * 4,
//                        animationSpec = tween(600, easing = EaseInOutElastic)
//                    )
//                    square1DisappearAlpha.animateTo(
//                        targetValue = 0f,
//                        animationSpec = tween(400)
//                    )
//
//                    delay(200)
//                     //Second square
//                    square2FallOffset.animateTo(
//                        targetValue = baseSquareSize.value * 4,
//                        animationSpec = tween(600, easing = EaseInOutElastic)
//                    )
//                    square2DisappearAlpha.animateTo(
//                        targetValue = 0f,
//                        animationSpec = tween(400)
//                    )
//
//                    delay(200)
//                     //Third square
//                    square3FallOffset.animateTo(
//                        targetValue = baseSquareSize.value * 4,
//                        animationSpec = tween(600, easing = EaseInOutElastic)
//                    )
//                    square3DisappearAlpha.animateTo(
//                        targetValue = 0f,
//                        animationSpec = tween(400)
//                    )
//                }
//
//                delay(1000)
//
                    delay(pauseDuration)
//                 Reset for next cycle
//                    listOf(
//                        square1YOffset, square2YOffset, square3YOffset,
//                        square1FallOffset, square2FallOffset, square3FallOffset,
//                        square1InitialAlpha, square2InitialAlpha, square3InitialAlpha,
//                        square1DisappearAlpha, square2DisappearAlpha, square3DisappearAlpha
//                    ).forEach { it.snapTo(0f) }
            }
        }

        // Create gradient brush
        val purpleGradient = Brush.linearGradient(
            colors = listOf(
                Color(0xFF492C78),
                Color(0xFF321D51)
            ),
//            start = Offset(0f, 0f),
//            end = Offset(1f, 1f)
        )

        @Composable
        fun AnimatedRoundedSquare(
            yOffset: Float,
            fallOffset: Float,
            initialAlpha: Float,
            disappearAlpha: Float
        ) {
            Box(
                modifier = Modifier
//                    .rotate(45f)
                    .offset(
                        x = horizontalOffset,
                        y = with(density) { yOffset.toDp() + fallOffset.toDp() }
                    )
                    .rotate(45f)
                    .size(baseSquareSize)
                    .clip(RoundedCornerShape(cornerRadius))
                    .background(purpleGradient)
                    .alpha(initialAlpha)
            )
        }

        // Draw animated squares
        AnimatedRoundedSquare(
            yOffset = square1YOffset.value,
            fallOffset = square1FallOffset.value,
            initialAlpha = square1InitialAlpha.value,
            disappearAlpha = square1DisappearAlpha.value
        )
        AnimatedRoundedSquare(
            yOffset = square2YOffset.value,
            fallOffset = square2FallOffset.value,
            initialAlpha = square2InitialAlpha.value,
            disappearAlpha = square2DisappearAlpha.value
        )
        AnimatedRoundedSquare(
            yOffset = square3YOffset.value,
            fallOffset = square3FallOffset.value,
            initialAlpha = square3InitialAlpha.value,
            disappearAlpha = square3DisappearAlpha.value
        )
    }
}

@SuppressLint("UnusedBoxWithConstraintsScope")
@Composable
fun DrawRoundedSquares(
    modifier: Modifier = Modifier
) {
    BoxWithConstraints(modifier = modifier.background(Color.White)) {
        val scale = minOf(
            constraints.maxWidth / 150f,
            constraints.maxHeight / 150f
        )

        // Convert scale factor to dp
        val density = LocalDensity.current
        val baseSquareSize = with(density) { (36 * scale).toDp() }
        val cornerRadius = with(density) { (7f * scale).toDp() }
        val verticalSpacing = with(density) { (30f * scale).toDp() }
        val horizontalOffset = with(density) { (7f * scale).toDp() }

        // Create gradient brush
        val purpleGradient = Brush.linearGradient(
            colors = listOf(
                Color(0xFF8D50F8),
                Color(0xFF673AB7),
                Color(0xFF492C78),
                Color(0xFF321D51),
                Color(0xFF150E2A),
                Color(0xFF180E28),
            ),
//            start = Offset(0f, 0f),
//            end = Offset(1f, 1f)
        )


        // Draw three rounded squares
        RoundedSquare(0, horizontalOffset, baseSquareSize, cornerRadius, verticalSpacing, purpleGradient)
        RoundedSquare(1, horizontalOffset, baseSquareSize, cornerRadius, verticalSpacing, purpleGradient)
        RoundedSquare(2, horizontalOffset, baseSquareSize, cornerRadius, verticalSpacing, purpleGradient)
    }
}

@Composable
fun RoundedSquare(
    yOffset: Int,
    horizontalOffset: Dp,
    baseSquareSize: Dp,
    cornerRadius: Dp,
    verticalSpacing: Dp,
    purpleGradient: Brush,
    rotation: Float = 45f
) {
    Box(
        modifier = Modifier
            .offset(x = horizontalOffset, y = verticalSpacing * yOffset)
            .rotate(rotation)
            .size(baseSquareSize)
            .clip(RoundedCornerShape(cornerRadius))
            .background(purpleGradient)
    )
}

@Composable
fun DynamicBuildingBlocks(
    blockSize: Dp = 20.dp,
    horizontalGap: Dp = 10.dp,
    verticalGap: Dp = 10.dp,
    columns: Int = 3, // Number of columns in the grid
    rows: Int = 3, // Number of rows in the grid
    modifier: Modifier = Modifier
) {
    val positions = mutableListOf<Pair<Dp, Dp>>()

    // Calculate block positions dynamically
    for (row in 0 until rows) {
        for (column in 0 until columns) {
            val offsetX: Dp = ((blockSize + horizontalGap) * column) - ((blockSize + horizontalGap) / 2 * (columns - 1))
            val offsetY = ((blockSize + verticalGap) * row) - (blockSize + verticalGap) / 2 * (rows - 1)
            positions.add(Pair(offsetX, offsetY))
        }
    }

    Box(
        modifier = modifier,
        contentAlignment = Alignment.Center
    ) {
        positions.forEachIndexed { index, position ->
            Block(
                size = blockSize,
                delay = index * 250,
                offsetX = position.first,
                offsetY = position.second
            )
        }
    }
}

@Composable
fun BuildingBlocks(modifier: Modifier = Modifier) {
    val positions = listOf(
        Pair(60.dp, 120.dp),
        Pair((-60).dp, 120.dp),
        Pair(120.dp, 0.dp),
        Pair(0.dp, 0.dp),
        Pair((-120).dp, 0.dp),
        Pair(60.dp, (-120).dp),
        Pair((-60).dp, (-120).dp)
    )

    Box(
        modifier = modifier,
        contentAlignment = Alignment.Center
    ) {
        positions.forEachIndexed { index, position ->
            Block(
                delay = index * 150,
                offsetX = position.first,
                offsetY = position.second
            )
        }
    }
}

@Composable
fun Block(delay: Int, size: Dp = 20.dp, offsetX: Dp, offsetY: Dp) {
    val transition = rememberInfiniteTransition()
    val alpha by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = keyframes {
                durationMillis = 2100 + 2400
                0f at 0
                0f at 420 + delay //TODO: fix this
                1f at 630 + delay
                1f at 1470 + delay
                0f at 1890 + delay
                0f at 2100 + 2400
            },
            repeatMode = RepeatMode.Restart
        )
    )

    val translateY by transition.animateFloat(
        initialValue = -300f,
        targetValue = 300f,
        animationSpec = infiniteRepeatable(
            animation = keyframes {7
                durationMillis = 2100 + 2400
                -300f at 0 // TODO: calculate keyframe positions based on duration
                -300f at 420 + delay
                0f at 630 + delay
                0f at 1470 + delay
                300f at 1890 + delay
                300f at 2100 + 2400
            },
            repeatMode = RepeatMode.Restart
        )
    )

    Box(
        modifier = Modifier
            .size(size)
            .offset(offsetX, offsetY)
            .graphicsLayer(
                alpha = alpha,
                translationY = translateY
            )
            .background(Color.Blue) // Replace with your desired color
    )
}

