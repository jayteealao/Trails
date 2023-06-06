package com.jayteealao.trails.ui.article

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.data.PocketRepository
import com.jayteealao.trails.data.local.database.PocketArticle
import com.jayteealao.trails.usecases.SaveWebArchiveUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ArticleViewModel @Inject constructor(
    private val pocketRepository: PocketRepository,
    private val saveWebArchiveUseCase: SaveWebArchiveUseCase,
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher
): ViewModel() {

    private var _article = MutableStateFlow<PocketArticle?>(null)
    val article: StateFlow<PocketArticle?>
        get() = _article

    fun getArticle(itemId: String) {
        viewModelScope.launch(ioDispatcher){
            _article.value = pocketRepository.getArticleById(itemId)
        }
    }

    fun saveWebArchive(url: String) {
        viewModelScope.launch {
            saveWebArchiveUseCase(url)
        }
    }
}