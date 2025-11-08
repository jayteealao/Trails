package com.jayteealao.trails.ui.adaptive

import androidx.compose.foundation.layout.Row
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfo
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.navigation3.runtime.NavEntry
import androidx.navigation3.scene.Scene
import androidx.navigation3.scene.SceneStrategy
import androidx.navigation3.scene.SceneStrategyScope
import androidx.window.core.layout.WindowSizeClass
import androidx.window.core.layout.WindowSizeClass.Companion.WIDTH_DP_MEDIUM_LOWER_BOUND

const val LIST_PANE = "list"
const val DETAIL_PANE = "detail"

class ListDetailScene<T : Any>(
    override val key: Any,
    override val previousEntries: List<NavEntry<T>>,
    val listEntry: NavEntry<T>,
    val detailEntry: NavEntry<T>?,
    val detailPlaceholder: @Composable () -> Unit,
) : Scene<T> {
    override val entries: List<NavEntry<T>> = listOfNotNull(listEntry, detailEntry)

    override val content: @Composable () -> Unit = {
        Row {
            listEntry.Content(modifier = Modifier.weight(1f))
            if (detailEntry != null) {
                detailEntry.Content(modifier = Modifier.weight(1f))
            } else {
                detailPlaceholder()
            }
        }
    }
}

@Composable
fun <T : Any> rememberListDetailSceneStrategy(
    detailPlaceholder: @Composable () -> Unit,
): ListDetailSceneStrategy<T> {
    val windowSizeClass = currentWindowAdaptiveInfo().windowSizeClass
    return remember(windowSizeClass) {
        ListDetailSceneStrategy(windowSizeClass, detailPlaceholder)
    }
}

class ListDetailSceneStrategy<T : Any>(
    private val windowSizeClass: WindowSizeClass,
    private val detailPlaceholder: @Composable () -> Unit,
) : SceneStrategy<T> {
    override fun SceneStrategyScope<T>.calculateScene(entries: List<NavEntry<T>>): Scene<T>? {
        if (!windowSizeClass.isWidthAtLeastBreakpoint(WIDTH_DP_MEDIUM_LOWER_BOUND)) {
            return null
        }

        val listEntry = entries.findLast { it.metadata[LIST_PANE] == true } ?: return null
        val detailEntry = entries.lastOrNull()?.takeIf { it.metadata[DETAIL_PANE] == true }

        return ListDetailScene(
            key = listEntry.contentKey,
            previousEntries = if (detailEntry != null) entries.dropLast(1) else entries,
            listEntry = listEntry,
            detailEntry = detailEntry,
            detailPlaceholder = detailPlaceholder
        )
    }
}
