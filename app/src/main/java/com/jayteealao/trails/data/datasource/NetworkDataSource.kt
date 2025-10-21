package com.jayteealao.trails.data.datasource

import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingSource
import androidx.paging.PagingState
import com.jayteealao.trails.common.CONSUMERKEY
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.data.SharedPreferencesManager
import com.jayteealao.trails.network.ArticleData
import com.jayteealao.trails.network.mapper.toArticleData
import com.jayteealao.trails.network.article.ArticleClient
import com.jayteealao.trails.usecases.GetAccessTokenFromLocalUseCase
import com.skydoves.sandwich.message
import com.skydoves.sandwich.onError
import com.skydoves.sandwich.onException
import com.skydoves.sandwich.onFailure
import com.skydoves.sandwich.onSuccess
import com.skydoves.sandwich.retrofit.errorBody
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.flow.first
import timber.log.Timber
import javax.inject.Inject

class NetworkDataSource @Inject constructor(
    private val articleClient: ArticleClient,
    private val getAccessTokenFromLocalUseCase: GetAccessTokenFromLocalUseCase,
    private val sharedPreferencesManager: SharedPreferencesManager,
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher
): PagingSource<Int, ArticleData>() {

    private val coroutineScope = CoroutineScope(ioDispatcher)

    suspend operator fun invoke(since: Long? = null, count: Int = 10, offset: Int = 0): MutableList<ArticleData> {
        val deferredList = mutableListOf<Deferred<Unit>>()
        var articles = mutableListOf<ArticleData>()

        val params = mutableMapOf(
            "consumer_key" to CONSUMERKEY,
            "access_token" to getAccessTokenFromLocalUseCase().first()!!,
            "state" to "all",
            "count" to count.toString(),
            "offset" to offset.toString(),
            "detailType" to "complete",
        ).apply {
            if (since != null) {
                this["since"] = since.toString()
            }
        }

        articleClient.retrieve(
            params = params
        ).onSuccess {
            articles = data.list.values.map { it.toArticleData() }.toMutableList()
            if (articles.isNotEmpty() && offset == 0) {
                sharedPreferencesManager.saveLong("since", articles[0].article.timeAdded)
            }
        }.onError {
            Timber.d("Error $errorBody")
        }.onFailure {
            Timber.d("Failure ${this.message()}")
        }.onException {
            Timber.d("Exception ${this.message()}")
        }

//        articles.forEachIndexed { index, articleItem ->
//            val deferred = coroutineScope.async {
//                articles[index].text = articleExtractor.extract(URL(articleItem.url))
//            }
//            deferredList.add(deferred)
//        }
//
//        deferredList.awaitAll()
        return articles
    }
//TODO: use pagingsource for syncing
    override fun getRefreshKey(state: PagingState<Int, ArticleData>): Int? {
        return state.anchorPosition?.let { anchorPosition ->
            state.closestPageToPosition(anchorPosition)?.prevKey?.plus(1)
                    ?: state.closestPageToPosition(anchorPosition)?.nextKey?.minus(1)
        }
    }

    override suspend fun load(params: LoadParams<Int>): LoadResult<Int, ArticleData> {
        return try {
            val nextPageNumber = params.key ?: 0
            val response = invoke(count = params.loadSize, offset = nextPageNumber)
            LoadResult.Page(
                data = response.toList(),
                prevKey = if (nextPageNumber == 0) null else nextPageNumber - 1,
                nextKey = if (response.isEmpty()) null else nextPageNumber + 1
            )
        } catch (e: Exception) {
            LoadResult.Error(e)
        }
    }

    val flow = Pager(
        config = PagingConfig(
            pageSize = 10,
            enablePlaceholders = false
        ),
        pagingSourceFactory = { this }
    ).flow

}