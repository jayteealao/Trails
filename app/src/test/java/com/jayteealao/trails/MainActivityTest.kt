package com.jayteealao.trails

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.navigation.compose.ComposeNavigator
import androidx.navigation.testing.TestNavHostController
import androidx.paging.PagingData
import com.jayteealao.trails.data.local.database.PocketArticle
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.data.models.EMPTYARTICLEITEM
import com.jayteealao.trails.data.models.PocketSummary
import com.jayteealao.trails.screens.articleDetail.ArticleDetailViewModel
import com.jayteealao.trails.screens.articleList.ArticleListViewModel
import com.jayteealao.trails.screens.articleSearch.ArticleSearchViewModel
import com.jayteealao.trails.screens.auth.AuthViewModel
import com.jayteealao.trails.screens.settings.SettingsViewModel
import com.jayteealao.trails.screens.theme.TrailsTheme
import io.mockk.any
import io.mockk.every
import io.mockk.firstArg
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class MainActivityTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun mainNavigationStartsAtMainDestination() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        val navController = TestNavHostController(activity).apply {
            navigatorProvider.addNavigator(ComposeNavigator())
        }

        val authViewModel = mockk<AuthViewModel>()
        every { authViewModel.isLoggedIn } returns MutableStateFlow(false)

        val articleListViewModel = mockk<ArticleListViewModel>()
        every { articleListViewModel.articles } returns MutableStateFlow(PagingData.from(emptyList<ArticleItem>()))
        every { articleListViewModel.databaseSync } returns MutableStateFlow(false)
        every { articleListViewModel.selectedArticleSummary } returns MutableStateFlow(PocketSummary())
        val selectedArticleFlow = MutableStateFlow(EMPTYARTICLEITEM)
        every { articleListViewModel.selectedArticle } returns selectedArticleFlow
        every { articleListViewModel.selectArticle(any()) } answers {
            selectedArticleFlow.value = firstArg()
            Unit
        }

        val articleDetailViewModel = mockk<ArticleDetailViewModel>()
        every { articleDetailViewModel.article } returns MutableStateFlow<PocketArticle?>(null)

        val articleSearchViewModel = mockk<ArticleSearchViewModel>(relaxed = true)
        every { articleSearchViewModel.searchResultsLocal } returns MutableStateFlow<List<ArticleItem>>(emptyList())
        every { articleSearchViewModel.searchResultsHybrid } returns MutableStateFlow<List<ArticleItem>>(emptyList())

        val settingsViewModel = mockk<SettingsViewModel>(relaxed = true)
        every { settingsViewModel.preferenceFlow } returns MutableStateFlow(false)
        every { settingsViewModel.jinaToken } returns MutableStateFlow("")
        every { settingsViewModel.jinaPlaceHolder } returns ""

        composeRule.setContent {
            TrailsTheme {
                MainNavigation(
                    authViewModel = authViewModel,
                    navController = navController,
                    articleListViewModel = articleListViewModel,
                    articleDetailViewModel = articleDetailViewModel,
                    articleSearchViewModel = articleSearchViewModel,
                    settingsViewModel = settingsViewModel,
                )
            }
        }

        composeRule.waitForIdle()

        assertEquals("main", navController.currentDestination?.route)
    }
}
