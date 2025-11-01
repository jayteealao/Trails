package com.jayteealao.trails.common

import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.core.graphics.createBitmap
import androidx.palette.graphics.Palette
import io.viascom.nanoid.NanoId
import java.security.MessageDigest
import java.security.SecureRandom

fun generateId(): String = NanoId.generate(14)

fun generateDeterministicNanoId(input: String): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val seed = digest.digest(input.toByteArray())
//    val hashString = hashBytes.fold("") { str, it -> str + "%02x".format(it) } // Convert to hex string


    // Use the hash as a seed for NanoID
    val random = SecureRandom(seed)
    return NanoId.generate(size = 14, random = random) // Specify desired length
}

/**
 * Extracts palette colors from a Drawable and updates state when complete.
 *
 * @param drawable The drawable to extract colors from
 * @param onColorsExtracted Callback invoked with (dominantColor, vibrantColor) when extraction completes
 */
fun extractPaletteFromBitmap(
    drawable: Drawable,
    onColorsExtracted: (Color, Color) -> Unit
) {
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

    // Extract palette asynchronously
    Palette.Builder(bitmap).generate { palette ->
        palette?.let {
            val dominantColor = Color(it.getDominantColor(Color.Transparent.toArgb()))
            val vibrantColor = Color(it.getVibrantColor(Color.Transparent.toArgb()))
            onColorsExtracted(dominantColor, vibrantColor)
        }
    }
}