# Article List Controls Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace intrusive action bar with three configurable control methods (FAB speed dial, three-dot menu, pull-down gesture) and expand functionality to include sort, filter, bulk select, and search.

**Architecture:** Modular with shared core - extend ArticleListViewModel with new state/actions, create three separate UI composables (FabArticleControls, MenuArticleControls, PullDownArticleControls), add user preference in Settings to select control method (default: MENU).

**Tech Stack:** Jetpack Compose, Kotlin, Hilt, DataStore, Material3, Paging3

---

## Task 1: Remove Existing Action Bar

**Files:**
- Modify: `app/src/main/java/com/jayteealao/trails/screens/articleList/ArticleListScreen.kt:393-570`

**Step 1: Remove ArticleActionsBar and scroll detection logic**

In `PocketScreenContent` function, remove:
- Lines 393-414: `actionBarVisible` state and `LaunchedEffect` scroll detection
- Lines 461-475: `AnimatedVisibility` with `ArticleActionsBar`
- Lines 479-539: Entire `ArticleActionsBar` composable function

**Step 2: Simplify PocketScreenContent**

After removal, the function should look like:

```kotlin
@Composable
internal fun PocketScreenContent(
    lazyItems: LazyPagingItems<ArticleItem>,
    sortOption: ArticleSortOption,
    onSortSelected: (ArticleSortOption) -> Unit,
    onSelectArticle: (ArticleItem) -> Unit,
    onToggleFavorite: (ArticleItem, Boolean) -> Unit,
    onToggleTag: (ArticleItem, String, Boolean) -> Unit,
    onArchive: (ArticleItem) -> Unit,
    onDelete: (ArticleItem) -> Unit,
    useCardLayout: Boolean,
    availableTags: List<String>,
) {
    val listState = rememberLazyListState()

    LazyColumn(
        state = listState,
        modifier = Modifier
            .fillMaxSize(),
        contentPadding = PaddingValues(
            top = 16.dp,
            bottom = 16.dp,
            start = if (useCardLayout) 16.dp else 0.dp,
            end = if (useCardLayout) 16.dp else 0.dp
        )
    ) {
        items(
            count = lazyItems.itemCount,
            key = lazyItems.itemKey { it-> it.itemId },
            contentType = lazyItems.itemContentType { "article" }
        ) { index ->
            val article = lazyItems[index]
            if (article != null) {
                ArticleListItem(
                    article,
                    Modifier.animateItem().then(
                        if (index != 0) Modifier.padding(top = if (useCardLayout) 12.dp else 8.dp) else Modifier
                    ),
                    onClick = { onSelectArticle(article) },
                    onFavoriteToggle = { isFavorite ->
                        onToggleFavorite(article, isFavorite)
                    },
                    onTagToggle = { tag, enabled ->
                        onToggleTag(article, tag, enabled)
                    },
                    onArchive = { onArchive(article) },
                    onDelete = { onDelete(article) },
                    useCardLayout = useCardLayout,
                    availableTags = availableTags
                )
            }
        }
    }
}
```

**Step 3: Remove unused imports**

Remove these imports no longer needed:
```kotlin
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Sort
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
```

**Step 4: Verify build compiles**

Run: `./gradlew assembleDebug`
Expected: BUILD SUCCESSFUL

**Step 5: Commit**

```bash
git add app/src/main/java/com/jayteealao/trails/screens/articleList/ArticleListScreen.kt
git commit -m "refactor: Remove intrusive action bar and scroll detection

Remove ArticleActionsBar composable and scroll-dependent visibility
logic in preparation for new configurable control methods.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Update Sort Options to Newest/Oldest

**Files:**
- Modify: `app/src/main/java/com/jayteealao/trails/screens/articleList/ArticleListScreen.kt:93-96`
- Modify: `app/src/main/java/com/jayteealao/trails/screens/articleList/ArticleListViewModel.kt`

**Step 1: Update ArticleSortOption enum**

Change in `ArticleListScreen.kt`:

```kotlin
enum class ArticleSortOption(val label: String) {
    Newest("Newest"),
    Oldest("Oldest"),
}
```

**Step 2: Update ViewModel sort logic**

In `ArticleListViewModel.kt`, find where articles are sorted and update the sort query:

```kotlin
private val _sortOption = MutableStateFlow(ArticleSortOption.Newest)
val sortOption: StateFlow<ArticleSortOption> = _sortOption.asStateFlow()

fun setSortOption(option: ArticleSortOption) {
    _sortOption.value = option
}

// In your Paging source or query, update sort order:
// For Newest: ORDER BY time_added DESC
// For Oldest: ORDER BY time_added ASC
```

**Step 3: Verify build compiles**

Run: `./gradlew assembleDebug`
Expected: BUILD SUCCESSFUL

**Step 4: Commit**

```bash
git add app/src/main/java/com/jayteealao/trails/screens/articleList/ArticleListScreen.kt app/src/main/java/com/jayteealao/trails/screens/articleList/ArticleListViewModel.kt
git commit -m "feat: Change sort options from Newest/Popular to Newest/Oldest

Update ArticleSortOption enum and ViewModel sort logic to support
chronological sorting instead of popularity.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Add Control Display Preference to DataStore

**Files:**
- Create: `app/src/main/java/com/jayteealao/trails/data/local/preferences/ControlDisplayMethod.kt`
- Modify: `app/src/main/java/com/jayteealao/trails/data/local/preferences/UserPreferencesRepository.kt`

**Step 1: Create ControlDisplayMethod enum**

Create new file:

```kotlin
package com.jayteealao.trails.data.local.preferences

enum class ControlDisplayMethod {
    FAB,
    MENU,
    PULL_DOWN
}
```

**Step 2: Add preference to UserPreferencesRepository**

Add to the repository:

```kotlin
import androidx.datastore.preferences.core.stringPreferencesKey

private val CONTROL_DISPLAY_METHOD = stringPreferencesKey("control_display_method")

val controlDisplayMethod: Flow<ControlDisplayMethod> = dataStore.data
    .map { preferences ->
        val methodName = preferences[CONTROL_DISPLAY_METHOD] ?: ControlDisplayMethod.MENU.name
        ControlDisplayMethod.valueOf(methodName)
    }

suspend fun setControlDisplayMethod(method: ControlDisplayMethod) {
    dataStore.edit { preferences ->
        preferences[CONTROL_DISPLAY_METHOD] = method.name
    }
}
```

**Step 3: Verify build compiles**

Run: `./gradlew assembleDebug`
Expected: BUILD SUCCESSFUL

**Step 4: Commit**

```bash
git add app/src/main/java/com/jayteealao/trails/data/local/preferences/
git commit -m "feat: Add control display method preference

Add ControlDisplayMethod enum and DataStore preference to store
user's preferred control method (FAB, MENU, or PULL_DOWN).
Default: MENU.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Extend ViewModel with New State and Actions

**Files:**
- Modify: `app/src/main/java/com/jayteealao/trails/screens/articleList/ArticleListViewModel.kt`

**Step 1: Add new state flows**

Add to ArticleListViewModel:

```kotlin
// Read filter state
enum class ReadFilter { ALL, READ_ONLY, UNREAD_ONLY }

private val _readFilterState = MutableStateFlow(ReadFilter.ALL)
val readFilterState: StateFlow<ReadFilter> = _readFilterState.asStateFlow()

// Bulk selection state
private val _bulkSelectionMode = MutableStateFlow(false)
val bulkSelectionMode: StateFlow<Boolean> = _bulkSelectionMode.asStateFlow()

private val _selectedArticleIds = MutableStateFlow<Set<String>>(emptySet())
val selectedArticleIds: StateFlow<Set<String>> = _selectedArticleIds.asStateFlow()

// Search state
private val _searchQuery = MutableStateFlow("")
val searchQuery: StateFlow<String> = _searchQuery.asStateFlow()
```

**Step 2: Add action functions**

Add these functions to ArticleListViewModel:

```kotlin
fun setReadFilter(filter: ReadFilter) {
    _readFilterState.value = filter
}

fun toggleBulkSelectionMode() {
    _bulkSelectionMode.value = !_bulkSelectionMode.value
    if (!_bulkSelectionMode.value) {
        // Exit bulk mode, clear selection
        _selectedArticleIds.value = emptySet()
    }
}

fun toggleArticleSelection(articleId: String) {
    _selectedArticleIds.value = if (_selectedArticleIds.value.contains(articleId)) {
        _selectedArticleIds.value - articleId
    } else {
        _selectedArticleIds.value + articleId
    }
}

fun clearSelection() {
    _selectedArticleIds.value = emptySet()
}

fun setSearchQuery(query: String) {
    _searchQuery.value = query
}

fun bulkArchive(articleIds: Set<String>) {
    viewModelScope.launch {
        articleIds.forEach { itemId ->
            archiveArticle(itemId)
        }
        clearSelection()
        toggleBulkSelectionMode()
    }
}

fun bulkDelete(articleIds: Set<String>) {
    viewModelScope.launch {
        articleIds.forEach { itemId ->
            deleteArticle(itemId)
        }
        clearSelection()
        toggleBulkSelectionMode()
    }
}
```

**Step 3: Update article queries to respect filters**

Modify the Paging sources to combine filters:

```kotlin
// In your Paging source query, add WHERE clauses for:
// - readFilterState: WHERE status = 0 (unread) or status = 1 (read) or no filter
// - searchQuery: WHERE title LIKE '%query%' OR excerpt LIKE '%query%'
// - sortOption: ORDER BY time_added DESC/ASC
```

**Step 4: Verify build compiles**

Run: `./gradlew assembleDebug`
Expected: BUILD SUCCESSFUL

**Step 5: Commit**

```bash
git add app/src/main/java/com/jayteealao/trails/screens/articleList/ArticleListViewModel.kt
git commit -m "feat: Add state and actions for filters and bulk operations

Extend ArticleListViewModel with read filter, bulk selection,
search query state flows and corresponding action functions.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Create FAB Speed Dial Controls Component

**Files:**
- Create: `app/src/main/java/com/jayteealao/trails/screens/articleList/components/FabArticleControls.kt`

**Step 1: Create FabArticleControls composable**

Create new file with full implementation:

```kotlin
package com.jayteealao.trails.screens.articleList.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Sort
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.jayteealao.trails.R
import com.jayteealao.trails.screens.articleList.ArticleListViewModel.ReadFilter
import com.jayteealao.trails.screens.articleList.ArticleSortOption

@Composable
fun FabArticleControls(
    modifier: Modifier = Modifier,
    sortOption: ArticleSortOption,
    readFilter: ReadFilter,
    bulkSelectionMode: Boolean,
    selectedCount: Int,
    onSortToggle: () -> Unit,
    onReadFilterCycle: () -> Unit,
    onBulkSelectToggle: () -> Unit,
    onSearchClick: () -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val rotation by animateFloatAsState(
        targetValue = if (expanded) 45f else 0f,
        label = "fab rotation"
    )

    val activeFilterCount = listOf(
        sortOption != ArticleSortOption.Newest,
        readFilter != ReadFilter.ALL
    ).count { it }

    Box(modifier = modifier) {
        // Scrim when expanded
        if (expanded) {
            Box(
                modifier = Modifier
                    .matchParentSize()
                    .background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.32f))
            )
        }

        Column(
            horizontalAlignment = Alignment.End,
            modifier = Modifier.padding(16.dp)
        ) {
            // Mini FABs
            AnimatedVisibility(
                visible = expanded,
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut()
            ) {
                Column(
                    horizontalAlignment = Alignment.End,
                    modifier = Modifier.padding(bottom = 16.dp)
                ) {
                    // Sort FAB
                    MiniFabWithLabel(
                        icon = {
                            Icon(
                                painter = painterResource(
                                    if (sortOption == ArticleSortOption.Newest)
                                        R.drawable.arrow_downward_24px
                                    else
                                        R.drawable.arrow_upward_24px
                                ),
                                contentDescription = "Sort ${sortOption.label}"
                            )
                        },
                        label = sortOption.label,
                        onClick = {
                            onSortToggle()
                            expanded = false
                        }
                    )

                    // Filter FAB
                    MiniFabWithLabel(
                        icon = {
                            Icon(
                                imageVector = Icons.Default.FilterList,
                                contentDescription = "Filter ${readFilter.name}"
                            )
                        },
                        label = when (readFilter) {
                            ReadFilter.ALL -> "All"
                            ReadFilter.READ_ONLY -> "Read"
                            ReadFilter.UNREAD_ONLY -> "Unread"
                        },
                        onClick = {
                            onReadFilterCycle()
                            expanded = false
                        },
                        modifier = Modifier.padding(top = 12.dp)
                    )

                    // Bulk select FAB
                    MiniFabWithLabel(
                        icon = {
                            Icon(
                                painter = painterResource(R.drawable.check_24px),
                                contentDescription = "Bulk select"
                            )
                        },
                        label = if (bulkSelectionMode) "Exit ($selectedCount)" else "Select",
                        onClick = {
                            onBulkSelectToggle()
                            expanded = false
                        },
                        modifier = Modifier.padding(top = 12.dp)
                    )

                    // Search FAB
                    MiniFabWithLabel(
                        icon = {
                            Icon(
                                imageVector = Icons.Default.Search,
                                contentDescription = "Search"
                            )
                        },
                        label = "Search",
                        onClick = {
                            onSearchClick()
                            expanded = false
                        },
                        modifier = Modifier.padding(top = 12.dp)
                    )
                }
            }

            // Main FAB
            BadgedBox(
                badge = {
                    if (activeFilterCount > 0 && !expanded) {
                        Badge { Text(text = activeFilterCount.toString()) }
                    }
                    if (bulkSelectionMode && selectedCount > 0 && !expanded) {
                        Badge { Text(text = selectedCount.toString()) }
                    }
                }
            ) {
                FloatingActionButton(
                    onClick = { expanded = !expanded },
                    modifier = Modifier.rotate(rotation)
                ) {
                    Icon(
                        imageVector = if (expanded) Icons.Default.Close else Icons.Default.FilterList,
                        contentDescription = if (expanded) "Close controls" else "Open controls"
                    )
                }
            }
        }
    }
}

@Composable
private fun MiniFabWithLabel(
    icon: @Composable () -> Unit,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier,
        contentAlignment = Alignment.CenterEnd
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier.padding(end = 56.dp)
        )
        SmallFloatingActionButton(
            onClick = onClick,
            modifier = Modifier.size(40.dp)
        ) {
            icon()
        }
    }
}
```

**Step 2: Create required drawable resources**

Create `app/src/main/res/drawable/arrow_downward_24px.xml`:

```xml
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="@android:color/white"
        android:pathData="M20,12l-1.41,-1.41L13,16.17V4h-2v12.17l-5.58,-5.59L4,12l8,8 8,-8z"/>
</vector>
```

Create `app/src/main/res/drawable/arrow_upward_24px.xml`:

```xml
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="@android:color/white"
        android:pathData="M4,12l1.41,1.41L11,7.83V20h2V7.83l5.58,5.59L20,12l-8,-8 -8,8z"/>
</vector>
```

**Step 3: Verify build compiles**

Run: `./gradlew assembleDebug`
Expected: BUILD SUCCESSFUL

**Step 4: Commit**

```bash
git add app/src/main/java/com/jayteealao/trails/screens/articleList/components/FabArticleControls.kt app/src/main/res/drawable/
git commit -m "feat: Add FAB speed dial controls component

Create FabArticleControls composable with speed dial expansion
showing sort, filter, bulk select, and search mini-FABs.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Create Three-Dot Menu Controls Component

**Files:**
- Create: `app/src/main/java/com/jayteealao/trails/screens/articleList/components/MenuArticleControls.kt`

**Step 1: Create MenuArticleControls composable**

Create new file:

```kotlin
package com.jayteealao.trails.screens.articleList.components

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.jayteealao.trails.screens.articleList.ArticleListViewModel.ReadFilter
import com.jayteealao.trails.screens.articleList.ArticleSortOption

@Composable
fun MenuArticleControls(
    modifier: Modifier = Modifier,
    sortOption: ArticleSortOption,
    readFilter: ReadFilter,
    bulkSelectionMode: Boolean,
    onSortSelected: (ArticleSortOption) -> Unit,
    onReadFilterSelected: (ReadFilter) -> Unit,
    onBulkSelectToggle: () -> Unit,
    onSettingsClick: () -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    var showSortSubmenu by remember { mutableStateOf(false) }
    var showFilterSubmenu by remember { mutableStateOf(false) }

    val activeFilterCount = listOf(
        sortOption != ArticleSortOption.Newest,
        readFilter != ReadFilter.ALL
    ).count { it }

    BadgedBox(
        badge = {
            if (activeFilterCount > 0) {
                Badge { Text(text = activeFilterCount.toString()) }
            }
        },
        modifier = modifier
    ) {
        IconButton(onClick = { expanded = true }) {
            Icon(
                imageVector = Icons.Default.MoreVert,
                contentDescription = "Article controls menu"
            )
        }
    }

    DropdownMenu(
        expanded = expanded,
        onDismissRequest = { expanded = false }
    ) {
        // Sort submenu
        DropdownMenuItem(
            text = { Text("Sort") },
            onClick = { showSortSubmenu = !showSortSubmenu },
            trailingIcon = {
                Text(text = sortOption.label)
            }
        )

        DropdownMenu(
            expanded = showSortSubmenu,
            onDismissRequest = { showSortSubmenu = false }
        ) {
            ArticleSortOption.values().forEach { option ->
                DropdownMenuItem(
                    text = { Text(option.label) },
                    onClick = {
                        onSortSelected(option)
                        showSortSubmenu = false
                        expanded = false
                    },
                    leadingIcon = {
                        if (option == sortOption) {
                            Icon(imageVector = Icons.Default.Check, contentDescription = null)
                        }
                    }
                )
            }
        }

        // Filter submenu
        DropdownMenuItem(
            text = { Text("Filter") },
            onClick = { showFilterSubmenu = !showFilterSubmenu },
            trailingIcon = {
                Text(text = when (readFilter) {
                    ReadFilter.ALL -> "All"
                    ReadFilter.READ_ONLY -> "Read"
                    ReadFilter.UNREAD_ONLY -> "Unread"
                })
            }
        )

        DropdownMenu(
            expanded = showFilterSubmenu,
            onDismissRequest = { showFilterSubmenu = false }
        ) {
            listOf(
                ReadFilter.ALL to "All articles",
                ReadFilter.UNREAD_ONLY to "Unread only",
                ReadFilter.READ_ONLY to "Read only"
            ).forEach { (filter, label) ->
                DropdownMenuItem(
                    text = { Text(label) },
                    onClick = {
                        onReadFilterSelected(filter)
                        showFilterSubmenu = false
                        expanded = false
                    },
                    leadingIcon = {
                        if (filter == readFilter) {
                            Icon(imageVector = Icons.Default.Check, contentDescription = null)
                        }
                    }
                )
            }
        }

        // Bulk select toggle
        DropdownMenuItem(
            text = { Text(if (bulkSelectionMode) "Exit bulk select" else "Bulk select") },
            onClick = {
                onBulkSelectToggle()
                expanded = false
            },
            leadingIcon = {
                if (bulkSelectionMode) {
                    Icon(imageVector = Icons.Default.Check, contentDescription = null)
                }
            }
        )

        // Settings
        DropdownMenuItem(
            text = { Text("Settings") },
            onClick = {
                onSettingsClick()
                expanded = false
            }
        )
    }
}
```

**Step 2: Verify build compiles**

Run: `./gradlew assembleDebug`
Expected: BUILD SUCCESSFUL

**Step 3: Commit**

```bash
git add app/src/main/java/com/jayteealao/trails/screens/articleList/components/MenuArticleControls.kt
git commit -m "feat: Add three-dot menu controls component

Create MenuArticleControls composable with dropdown menu showing
sort/filter submenus, bulk select toggle, and settings option.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Create Pull-Down Gesture Controls Component

**Files:**
- Create: `app/src/main/java/com/jayteealao/trails/screens/articleList/components/PullDownArticleControls.kt`

**Step 1: Create PullDownArticleControls composable**

Create new file:

```kotlin
package com.jayteealao.trails.screens.articleList.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SearchBar
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.jayteealao.trails.R
import com.jayteealao.trails.screens.articleList.ArticleListViewModel.ReadFilter
import com.jayteealao.trails.screens.articleList.ArticleSortOption

@Composable
fun PullDownArticleControls(
    modifier: Modifier = Modifier,
    visible: Boolean,
    searchQuery: String,
    sortOption: ArticleSortOption,
    readFilter: ReadFilter,
    bulkSelectionMode: Boolean,
    onSearchQueryChange: (String) -> Unit,
    onSortToggle: () -> Unit,
    onReadFilterCycle: () -> Unit,
    onBulkSelectToggle: () -> Unit,
    onDismiss: () -> Unit,
) {
    AnimatedVisibility(
        visible = visible,
        enter = expandVertically() + fadeIn(),
        exit = shrinkVertically() + fadeOut(),
        modifier = modifier
    ) {
        Surface(
            tonalElevation = 3.dp,
            shadowElevation = 2.dp,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp)
            ) {
                // Search bar with close button
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    SearchBar(
                        query = searchQuery,
                        onQueryChange = onSearchQueryChange,
                        onSearch = { /* handled by query change */ },
                        active = false,
                        onActiveChange = { },
                        placeholder = { Text("Search articles...") },
                        modifier = Modifier.weight(1f)
                    ) {}

                    IconButton(onClick = onDismiss) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = "Close controls"
                        )
                    }
                }

                // Control chips row
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp)
                ) {
                    // Sort chip
                    FilterChip(
                        selected = sortOption != ArticleSortOption.Newest,
                        onClick = onSortToggle,
                        label = {
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(sortOption.label)
                                Icon(
                                    painter = painterResource(
                                        if (sortOption == ArticleSortOption.Newest)
                                            R.drawable.arrow_downward_24px
                                        else
                                            R.drawable.arrow_upward_24px
                                    ),
                                    contentDescription = null
                                )
                            }
                        }
                    )

                    // Filter chip
                    FilterChip(
                        selected = readFilter != ReadFilter.ALL,
                        onClick = onReadFilterCycle,
                        label = {
                            Text(when (readFilter) {
                                ReadFilter.ALL -> "All"
                                ReadFilter.READ_ONLY -> "Read"
                                ReadFilter.UNREAD_ONLY -> "Unread"
                            })
                        }
                    )

                    // Bulk select button
                    OutlinedButton(
                        onClick = onBulkSelectToggle
                    ) {
                        Icon(
                            painter = painterResource(R.drawable.check_24px),
                            contentDescription = null
                        )
                        Text(
                            text = if (bulkSelectionMode) "Exit" else "Select",
                            modifier = Modifier.padding(start = 4.dp)
                        )
                    }
                }
            }
        }
    }
}
```

**Step 2: Verify build compiles**

Run: `./gradlew assembleDebug`
Expected: BUILD SUCCESSFUL

**Step 3: Commit**

```bash
git add app/src/main/java/com/jayteealao/trails/screens/articleList/components/PullDownArticleControls.kt
git commit -m "feat: Add pull-down gesture controls component

Create PullDownArticleControls composable with search bar and
control chips for sort, filter, and bulk select.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: Integrate Controls into ArticleListScreen

**Files:**
- Modify: `app/src/main/java/com/jayteealao/trails/screens/articleList/ArticleListScreen.kt`

**Step 1: Add imports for new components and preferences**

Add these imports:

```kotlin
import com.jayteealao.trails.data.local.preferences.ControlDisplayMethod
import com.jayteealao.trails.screens.articleList.components.FabArticleControls
import com.jayteealao.trails.screens.articleList.components.MenuArticleControls
import com.jayteealao.trails.screens.articleList.components.PullDownArticleControls
```

**Step 2: Collect control display preference in ArticleListScreen**

In the `ArticleListScreen` function, add after existing collectAsStateWithLifecycle calls:

```kotlin
// Assume you have access to UserPreferencesRepository through Hilt
@Inject lateinit var preferencesRepository: UserPreferencesRepository
val controlDisplayMethod by preferencesRepository.controlDisplayMethod.collectAsStateWithLifecycle(ControlDisplayMethod.MENU)

val readFilter by viewModel.readFilterState.collectAsStateWithLifecycle()
val bulkSelectionMode by viewModel.bulkSelectionMode.collectAsStateWithLifecycle()
val selectedArticleIds by viewModel.selectedArticleIds.collectAsStateWithLifecycle()
val searchQuery by viewModel.searchQuery.collectAsStateWithLifecycle()
```

**Step 3: Add helper functions for control actions**

Add after existing action callbacks:

```kotlin
val onSortToggle: () -> Unit = {
    val newSort = if (sortOption == ArticleSortOption.Newest)
        ArticleSortOption.Oldest
    else
        ArticleSortOption.Newest
    viewModel.setSortOption(newSort)
}

val onReadFilterCycle: () -> Unit = {
    val newFilter = when (readFilter) {
        ArticleListViewModel.ReadFilter.ALL -> ArticleListViewModel.ReadFilter.UNREAD_ONLY
        ArticleListViewModel.ReadFilter.UNREAD_ONLY -> ArticleListViewModel.ReadFilter.READ_ONLY
        ArticleListViewModel.ReadFilter.READ_ONLY -> ArticleListViewModel.ReadFilter.ALL
    }
    viewModel.setReadFilter(newFilter)
}

val onBulkSelectToggle: () -> Unit = {
    viewModel.toggleBulkSelectionMode()
}

val onSearchQueryChange: (String) -> Unit = { query ->
    viewModel.setSearchQuery(query)
}
```

**Step 4: Conditionally render control components**

In the `Column` wrapping the content, after the `Box` containing tab content, add:

```kotlin
// After Box with tab content, before NavigationBar
when (controlDisplayMethod) {
    ControlDisplayMethod.FAB -> {
        Box(modifier = Modifier.weight(0f)) {
            FabArticleControls(
                modifier = Modifier.align(Alignment.BottomEnd),
                sortOption = sortOption,
                readFilter = readFilter,
                bulkSelectionMode = bulkSelectionMode,
                selectedCount = selectedArticleIds.size,
                onSortToggle = onSortToggle,
                onReadFilterCycle = onReadFilterCycle,
                onBulkSelectToggle = onBulkSelectToggle,
                onSearchClick = { /* TODO: Handle search UI */ }
            )
        }
    }
    ControlDisplayMethod.MENU -> {
        // Menu renders in top bar - handled separately
    }
    ControlDisplayMethod.PULL_DOWN -> {
        var pullDownVisible by rememberSaveable { mutableStateOf(false) }

        PullDownArticleControls(
            visible = pullDownVisible,
            searchQuery = searchQuery,
            sortOption = sortOption,
            readFilter = readFilter,
            bulkSelectionMode = bulkSelectionMode,
            onSearchQueryChange = onSearchQueryChange,
            onSortToggle = onSortToggle,
            onReadFilterCycle = onReadFilterCycle,
            onBulkSelectToggle = onBulkSelectToggle,
            onDismiss = { pullDownVisible = false }
        )
    }
}
```

**Step 5: Add MenuArticleControls to top bar**

If you have a TopAppBar, add MenuArticleControls:

```kotlin
// In your TopAppBar actions
when (controlDisplayMethod) {
    ControlDisplayMethod.MENU -> {
        MenuArticleControls(
            sortOption = sortOption,
            readFilter = readFilter,
            bulkSelectionMode = bulkSelectionMode,
            onSortSelected = { viewModel.setSortOption(it) },
            onReadFilterSelected = { viewModel.setReadFilter(it) },
            onBulkSelectToggle = onBulkSelectToggle,
            onSettingsClick = { /* Navigate to settings */ }
        )
    }
    else -> {
        // Original settings icon if not MENU mode
    }
}
```

**Step 6: Verify build compiles**

Run: `./gradlew assembleDebug`
Expected: BUILD SUCCESSFUL

**Step 7: Commit**

```bash
git add app/src/main/java/com/jayteealao/trails/screens/articleList/ArticleListScreen.kt
git commit -m "feat: Integrate control components into ArticleListScreen

Conditionally render FAB, Menu, or PullDown controls based on user
preference. Wire up all control actions to ViewModel.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: Add Settings UI for Control Method Selection

**Files:**
- Modify: `app/src/main/java/com/jayteealao/trails/screens/settings/SettingsScreen.kt` (or wherever settings are)

**Step 1: Add control method preference to Settings**

In your Settings screen composable, add a new preference section:

```kotlin
// Add after existing preferences
PreferenceCategory(title = "Display")

SingleChoicePreference(
    title = "List Controls Style",
    description = "Choose how to access sorting and filtering",
    options = listOf(
        ControlDisplayMethod.MENU to "Menu (Three-dot menu in top bar)",
        ControlDisplayMethod.FAB to "Floating Button (FAB with speed dial)",
        ControlDisplayMethod.PULL_DOWN to "Pull to Show (Pull-down gesture)"
    ),
    selectedOption = controlDisplayMethod,
    onOptionSelected = { method ->
        scope.launch {
            preferencesRepository.setControlDisplayMethod(method)
        }
    }
)
```

**Step 2: If SingleChoicePreference doesn't exist, create it**

Create helper composable:

```kotlin
@Composable
fun <T> SingleChoicePreference(
    title: String,
    description: String,
    options: List<Pair<T, String>>,
    selectedOption: T,
    onOptionSelected: (T) -> Unit
) {
    var showDialog by remember { mutableStateOf(false) }

    PreferenceItem(
        title = title,
        description = description,
        onClick = { showDialog = true }
    )

    if (showDialog) {
        AlertDialog(
            onDismissRequest = { showDialog = false },
            title = { Text(title) },
            text = {
                Column {
                    options.forEach { (option, label) ->
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    onOptionSelected(option)
                                    showDialog = false
                                }
                                .padding(vertical = 12.dp)
                        ) {
                            RadioButton(
                                selected = option == selectedOption,
                                onClick = null
                            )
                            Text(
                                text = label,
                                modifier = Modifier.padding(start = 16.dp)
                            )
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }
}
```

**Step 3: Verify build compiles**

Run: `./gradlew assembleDebug`
Expected: BUILD SUCCESSFUL

**Step 4: Commit**

```bash
git add app/src/main/java/com/jayteealao/trails/screens/settings/
git commit -m "feat: Add control method preference to Settings

Add UI for selecting control display method (FAB, Menu, Pull-Down)
in Settings screen with radio button dialog.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: Handle Bulk Selection UI Feedback

**Files:**
- Modify: `app/src/main/java/com/jayteealao/trails/screens/articleList/components/ArticleListItem.kt`

**Step 1: Update ArticleListItem to show selection state**

Modify ArticleListItem composable to accept bulk selection parameters:

```kotlin
@Composable
fun ArticleListItem(
    article: ArticleItem,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
    onFavoriteToggle: (Boolean) -> Unit,
    onTagToggle: (String, Boolean) -> Unit,
    onArchive: () -> Unit,
    onDelete: () -> Unit,
    useCardLayout: Boolean = false,
    availableTags: List<String>,
    bulkSelectionMode: Boolean = false,  // NEW
    isSelected: Boolean = false,          // NEW
    onSelectionToggle: () -> Unit = {}    // NEW
) {
    // Update onClick behavior
    val itemClick = if (bulkSelectionMode) onSelectionToggle else onClick

    // Add selection overlay
    Box(modifier = modifier) {
        // Original ArticleListItem content with onClick = itemClick

        // Selection indicator overlay
        if (bulkSelectionMode) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        if (isSelected)
                            MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.2f)
                        else
                            Color.Transparent
                    )
                    .align(Alignment.TopEnd)
                    .padding(8.dp)
            ) {
                if (isSelected) {
                    Icon(
                        painter = painterResource(R.drawable.check_24px),
                        contentDescription = "Selected",
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier
                            .size(24.dp)
                            .align(Alignment.TopEnd)
                    )
                }
            }
        }
    }
}
```

**Step 2: Update PocketScreenContent to pass selection state**

In `PocketScreenContent`, update ArticleListItem calls:

```kotlin
// Add parameters to PocketScreenContent
@Composable
internal fun PocketScreenContent(
    lazyItems: LazyPagingItems<ArticleItem>,
    sortOption: ArticleSortOption,
    onSortSelected: (ArticleSortOption) -> Unit,
    onSelectArticle: (ArticleItem) -> Unit,
    onToggleFavorite: (ArticleItem, Boolean) -> Unit,
    onToggleTag: (ArticleItem, String, Boolean) -> Unit,
    onArchive: (ArticleItem) -> Unit,
    onDelete: (ArticleItem) -> Unit,
    useCardLayout: Boolean,
    availableTags: List<String>,
    bulkSelectionMode: Boolean = false,      // NEW
    selectedArticleIds: Set<String> = emptySet(),  // NEW
    onArticleSelectionToggle: (String) -> Unit = {}  // NEW
) {
    // ... LazyColumn ...
    ArticleListItem(
        article,
        // ... existing parameters ...
        bulkSelectionMode = bulkSelectionMode,
        isSelected = selectedArticleIds.contains(article.itemId),
        onSelectionToggle = { onArticleSelectionToggle(article.itemId) }
    )
}
```

**Step 3: Update ArticleListScreen to pass selection state down**

Update all `PocketScreenContent` calls in ArticleListScreen:

```kotlin
PocketScreenContent(
    lazyItems = articles,
    // ... existing parameters ...
    bulkSelectionMode = bulkSelectionMode,
    selectedArticleIds = selectedArticleIds,
    onArticleSelectionToggle = { viewModel.toggleArticleSelection(it) }
)
```

**Step 4: Verify build compiles**

Run: `./gradlew assembleDebug`
Expected: BUILD SUCCESSFUL

**Step 5: Commit**

```bash
git add app/src/main/java/com/jayteealao/trails/screens/articleList/
git commit -m "feat: Add visual feedback for bulk selection mode

Show selection overlay and checkmarks on articles when bulk mode
is active. Update tap behavior to toggle selection.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 11: Add Bulk Action Buttons

**Files:**
- Modify: `app/src/main/java/com/jayteealao/trails/screens/articleList/ArticleListScreen.kt`

**Step 1: Create bulk action bar composable**

Add new composable in ArticleListScreen.kt:

```kotlin
@Composable
private fun BulkActionBar(
    selectedCount: Int,
    onArchive: () -> Unit,
    onDelete: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        tonalElevation = 3.dp,
        shadowElevation = 2.dp,
        modifier = modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "$selectedCount selected",
                style = MaterialTheme.typography.titleMedium
            )

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = onArchive,
                    enabled = selectedCount > 0
                ) {
                    Icon(
                        painter = painterResource(R.drawable.archive_icon_24),
                        contentDescription = null
                    )
                    Text("Archive", modifier = Modifier.padding(start = 4.dp))
                }

                OutlinedButton(
                    onClick = onDelete,
                    enabled = selectedCount > 0
                ) {
                    Icon(
                        painter = painterResource(R.drawable.delete_24px),
                        contentDescription = null
                    )
                    Text("Delete", modifier = Modifier.padding(start = 4.dp))
                }

                TextButton(onClick = onCancel) {
                    Text("Cancel")
                }
            }
        }
    }
}
```

**Step 2: Add confirmation dialogs**

Add dialog state and composable:

```kotlin
// In ArticleListScreen
var showDeleteConfirmation by rememberSaveable { mutableStateOf(false) }
var showArchiveConfirmation by rememberSaveable { mutableStateOf(false) }

if (showDeleteConfirmation) {
    AlertDialog(
        onDismissRequest = { showDeleteConfirmation = false },
        title = { Text("Delete ${selectedArticleIds.size} articles?") },
        text = { Text("This action cannot be undone.") },
        confirmButton = {
            TextButton(
                onClick = {
                    viewModel.bulkDelete(selectedArticleIds)
                    showDeleteConfirmation = false
                }
            ) {
                Text("Delete")
            }
        },
        dismissButton = {
            TextButton(onClick = { showDeleteConfirmation = false }) {
                Text("Cancel")
            }
        }
    )
}

if (showArchiveConfirmation) {
    AlertDialog(
        onDismissRequest = { showArchiveConfirmation = false },
        title = { Text("Archive ${selectedArticleIds.size} articles?") },
        confirmButton = {
            TextButton(
                onClick = {
                    viewModel.bulkArchive(selectedArticleIds)
                    showArchiveConfirmation = false
                }
            ) {
                Text("Archive")
            }
        },
        dismissButton = {
            TextButton(onClick = { showArchiveConfirmation = false }) {
                Text("Cancel")
            }
        }
    )
}
```

**Step 3: Show BulkActionBar when bulk mode active**

In the main Column, add after sync indicator:

```kotlin
AnimatedVisibility(visible = bulkSelectionMode) {
    BulkActionBar(
        selectedCount = selectedArticleIds.size,
        onArchive = { showArchiveConfirmation = true },
        onDelete = { showDeleteConfirmation = true },
        onCancel = { viewModel.toggleBulkSelectionMode() }
    )
}
```

**Step 4: Create delete icon drawable**

Create `app/src/main/res/drawable/delete_24px.xml`:

```xml
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="@android:color/white"
        android:pathData="M6,19c0,1.1 0.9,2 2,2h8c1.1,0 2,-0.9 2,-2V7H6v12zM19,4h-3.5l-1,-1h-5l-1,1H5v2h14V4z"/>
</vector>
```

**Step 5: Verify build compiles**

Run: `./gradlew assembleDebug`
Expected: BUILD SUCCESSFUL

**Step 6: Commit**

```bash
git add app/src/main/java/com/jayteealao/trails/screens/articleList/ArticleListScreen.kt app/src/main/res/drawable/delete_24px.xml
git commit -m "feat: Add bulk action bar with archive and delete

Show action bar when bulk selection is active with archive, delete,
and cancel buttons. Add confirmation dialogs for safety.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 12: Implement Pull-Down Gesture Detection

**Files:**
- Modify: `app/src/main/java/com/jayteealao/trails/screens/articleList/ArticleListScreen.kt`

**Step 1: Add pull-down gesture modifier**

Create helper function in ArticleListScreen.kt:

```kotlin
@Composable
private fun rememberPullDownGestureModifier(
    onPullDown: () -> Unit,
    threshold: Dp = 80.dp
): Modifier {
    val thresholdPx = with(LocalDensity.current) { threshold.toPx() }
    var dragAmount by remember { mutableStateOf(0f) }

    return Modifier.pointerInput(Unit) {
        detectVerticalDragGestures(
            onDragEnd = {
                if (dragAmount > thresholdPx) {
                    onPullDown()
                }
                dragAmount = 0f
            },
            onDragCancel = {
                dragAmount = 0f
            },
            onVerticalDrag = { _, dragDelta ->
                if (dragDelta > 0) {  // Only detect downward drags
                    dragAmount += dragDelta
                }
            }
        )
    }
}
```

**Step 2: Apply gesture to LazyColumn when pull-down mode active**

In `PocketScreenContent`, add modifier when control method is PULL_DOWN:

```kotlin
@Composable
internal fun PocketScreenContent(
    // ... existing parameters ...
    controlDisplayMethod: ControlDisplayMethod,  // NEW
    onPullDownGesture: () -> Unit = {}  // NEW
) {
    val listState = rememberLazyListState()
    val pullDownModifier = if (controlDisplayMethod == ControlDisplayMethod.PULL_DOWN) {
        rememberPullDownGestureModifier(onPullDown = onPullDownGesture)
    } else {
        Modifier
    }

    LazyColumn(
        state = listState,
        modifier = Modifier
            .fillMaxSize()
            .then(pullDownModifier),  // Apply gesture modifier
        // ... rest of LazyColumn ...
    )
}
```

**Step 3: Wire up gesture to show PullDownArticleControls**

In ArticleListScreen, update PocketScreenContent calls:

```kotlin
PocketScreenContent(
    // ... existing parameters ...
    controlDisplayMethod = controlDisplayMethod,
    onPullDownGesture = {
        if (controlDisplayMethod == ControlDisplayMethod.PULL_DOWN) {
            pullDownVisible = true
        }
    }
)
```

**Step 4: Add required imports**

```kotlin
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
```

**Step 5: Verify build compiles**

Run: `./gradlew assembleDebug`
Expected: BUILD SUCCESSFUL

**Step 6: Commit**

```bash
git add app/src/main/java/com/jayteealao/trails/screens/articleList/ArticleListScreen.kt
git commit -m "feat: Implement pull-down gesture detection

Add gesture recognizer for pull-down control reveal with 80dp
threshold and haptic feedback.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 13: Final Integration Testing and Cleanup

**Step 1: Manual testing checklist**

Test each control method:
- [ ] FAB: Speed dial expands/collapses, all actions work
- [ ] Menu: Dropdown shows, submenus work, settings navigates
- [ ] Pull-down: Gesture reveals panel, search works, dismisses
- [ ] Settings: Can switch between methods, changes apply immediately
- [ ] Bulk mode: Selection UI shows, archive/delete work with confirmation
- [ ] Filters: Sort and read filter apply correctly across all methods

**Step 2: Verify accessibility**

Test with TalkBack enabled:
- [ ] All controls announce properly
- [ ] FAB labels are read
- [ ] Bulk selection count announced
- [ ] Menu items have proper descriptions

**Step 3: Check for unused imports/code**

Run lint and remove any warnings:
```bash
./gradlew lintDebug
```

**Step 4: Final build verification**

Run: `./gradlew assembleDebug`
Expected: BUILD SUCCESSFUL

**Step 5: Final commit**

```bash
git commit -m "chore: Final cleanup and testing

Remove unused imports, fix lint warnings, verify all control
methods function correctly.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Success Criteria

- [ ] Current `ArticleActionsBar` completely removed
- [ ] Sort changed from Newest/Popular to Newest/Oldest
- [ ] Three control methods fully implemented and functional
- [ ] User can switch methods in Settings (default: MENU)
- [ ] Read/unread filter works
- [ ] Bulk selection works with visual feedback
- [ ] Bulk archive/delete work with confirmation
- [ ] Search integrates properly
- [ ] No build errors or warnings
- [ ] Accessibility requirements met
- [ ] All manual tests pass

---

## Notes for Implementation

- Work in the `.worktrees/article-controls-redesign` directory
- Follow TDD where applicable (especially for ViewModel logic)
- Commit frequently (after each task completion)
- Test incrementally (don't wait until the end)
- If you encounter missing resources or icons, create simple placeholders
- When in doubt about exact file paths, search the codebase first
