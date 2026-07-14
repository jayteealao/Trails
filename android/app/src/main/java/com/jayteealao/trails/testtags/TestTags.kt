package com.jayteealao.trails.testtags

/**
 * Stable selection anchors for UI characterization tests.
 *
 * These constants are inert: they attach `Modifier.testTag(...)` labels to production
 * composables but change no runtime behaviour, layout, or appearance. They exist so the
 * characterization suites can select nodes by a stable id rather than by brittle text
 * matching. A behaviour-preserving refactor (such as the AGP 9 migration this coverage
 * guards) will not move a tag, which is exactly the property a golden-master test needs.
 */
object ArticleListTestTags {
    /** Root container of the article list / grid content. */
    const val LIST_ROOT = "articleList_root"

    /** Per-item tag, keyed by the article's stable [itemId]. */
    fun item(itemId: String): String = "articleList_item_$itemId"
}

/**
 * Selection anchors for the Navigation 3 list/detail panes driven from [com.jayteealao.trails.MainNavigation].
 * Used by the instrumented end-to-end navigation characterization test.
 */
object MainNavTestTags {
    const val LIST_PANE = "mainNav_listPane"
    const val DETAIL_PANE = "mainNav_detailPane"
}
