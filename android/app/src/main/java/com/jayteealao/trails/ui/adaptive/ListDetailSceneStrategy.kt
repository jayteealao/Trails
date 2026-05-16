package com.jayteealao.trails.ui.adaptive

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfo
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.navigation3.runtime.NavEntry
import androidx.navigation3.scene.Scene
import androidx.navigation3.scene.SceneStrategy
import androidx.navigation3.scene.SceneStrategyScope
import androidx.window.core.layout.WindowSizeClass
import androidx.window.core.layout.WindowSizeClass.Companion.WIDTH_DP_MEDIUM_LOWER_BOUND

class TrailsListDetailScene<T : Any>(
    override val key: Any,
    override val previousEntries: List<NavEntry<T>>,
    val listEntry: NavEntry<T>,
    val detailEntry: NavEntry<T>?,
) : Scene<T> {
    override val entries: List<NavEntry<T>> = listOfNotNull(listEntry, detailEntry)

    override val content: @Composable () -> Unit = {
        if (detailEntry != null) {
            Row {
                Column(modifier = Modifier.weight(0.4f)) {
                    listEntry.Content()
                }

                Column(modifier = Modifier.weight(0.6f)) {
                    detailEntry.Content()
                }
            }
        } else {
            listEntry.Content()
        }
    }
}


@Composable
fun <T : Any> rememberTrailsListDetailSceneStrategy(
//    appBackStack: AppBackStack
): TrailsListDetailSceneStrategy<T> {
    val windowSizeClass = currentWindowAdaptiveInfo().windowSizeClass
    return remember(
        windowSizeClass,
//        appBackStack
    ) {
        TrailsListDetailSceneStrategy(windowSizeClass)
    }
}

class TrailsListDetailSceneStrategy<T : Any>(
    private val windowSizeClass: WindowSizeClass,
) : SceneStrategy<T> {

    override fun SceneStrategyScope<T>.calculateScene(entries: List<NavEntry<T>>): Scene<T>? {
        if (!windowSizeClass.isWidthAtLeastBreakpoint(WIDTH_DP_MEDIUM_LOWER_BOUND)) {
            return null
        }

        val listEntry = entries.findLast { it.metadata[LIST_KEY] == true } ?: return null
        val detailEntry = entries.lastOrNull()?.takeIf { it.metadata[DETAIL_KEY] == true }

        return TrailsListDetailScene(
            key = listEntry.contentKey,
            previousEntries = entries.dropLast(1),
            listEntry = listEntry,
            detailEntry = detailEntry,
        )
    }

    companion object {
        internal const val LIST_KEY = "ListDetailScene-List"
        internal const val DETAIL_KEY = "ListDetailScene-Detail"

        /**
         * Helper function to add metadata to a [NavEntry] indicating it can be displayed
         * as a list in the [TrailsListDetailScene].
         */
        fun listPane() = mapOf(LIST_KEY to true)

        /**
         * Helper function to add metadata to a [NavEntry] indicating it can be displayed
         * as a list in the [TrailsListDetailScene].
         */
        fun detailPane() = mapOf(DETAIL_KEY to true)
    }
}
