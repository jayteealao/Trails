package com.jayteealao.trails.screens.articleDetail

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.local.database.PocketArticle
import com.jayteealao.trails.services.semanticSearch.modal.ModalClient
import com.jayteealao.trails.usecases.SaveWebArchiveUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ArticleDetailViewModel @Inject constructor(
    private val pocketRepository: ArticleRepository,
    private val saveWebArchiveUseCase: SaveWebArchiveUseCase,
    private val modalClient: ModalClient,
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

    fun test() {
        viewModelScope.launch(ioDispatcher) {
//            modalClient.deleteAll()
            article.collect {
                if (it != null) {
//                    val result = modalClient.addArticle(
//                        ModalArticle(it.itemId, it.text ?: "")
//                    ).getOrElse { ResponseModel("Failed to return success") }
//                    Timber.d(result.text)
//                    val result = weaviateService.insertDataObject(it)
//                    Timber.d(result.toString())
                }
            }
        }
    }
}