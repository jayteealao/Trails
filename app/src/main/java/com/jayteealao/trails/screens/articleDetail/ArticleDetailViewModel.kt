package com.jayteealao.trails.screens.articleDetail

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jayteealao.trails.common.UrlModifier
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.SharedPreferencesManager
import com.jayteealao.trails.data.local.database.PocketArticle
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

@HiltViewModel
class ArticleDetailViewModel @Inject constructor(
    private val pocketRepository: ArticleRepository,
    private val sharedPreferencesManager: SharedPreferencesManager,
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher
): ViewModel() {

    private var _article = MutableStateFlow<PocketArticle?>(null)
    val article: StateFlow<PocketArticle?>
        get() = _article

    var _jinaToken = MutableStateFlow("")

    val jinaToken: StateFlow<String>
        get() = _jinaToken

    fun updateJinaToken(token: String) {
        _jinaToken.value = token
    }

    val jinaPlaceHolder = sharedPreferencesManager.getString("JINA_TOKEN") ?: "Insert Jina Token Here"

    fun getArticle(itemId: String) {
        viewModelScope.launch(ioDispatcher){
            val modifier = UrlModifier()
            var articleFetched = pocketRepository.getArticleById(itemId)
            if (useFreediumFlow.value && articleFetched != null) {
                articleFetched = articleFetched.copy(
                    url = modifier.modifyUrl(articleFetched.url ?: articleFetched.givenUrl!!)
                )
            }
            _article.value = articleFetched

        }
    }

    val useFreediumFlow = sharedPreferencesManager.preferenceChangesFlow()
        .filter {
            it == "USE_FREEDIUM"
        }.map {
            Timber.d("Preference changed: $it")
            sharedPreferencesManager.getBoolean(it!!)
        }.stateIn(
            scope = viewModelScope,
            started = kotlinx.coroutines.flow.SharingStarted.Eagerly,
            initialValue = sharedPreferencesManager.getBoolean("USE_FREEDIUM")
        )

}