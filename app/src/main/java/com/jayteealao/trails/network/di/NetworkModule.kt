package com.jayteealao.trails.network.di

import android.content.Context
import com.chuckerteam.chucker.api.ChuckerCollector
import com.chuckerteam.chucker.api.ChuckerInterceptor
import com.chuckerteam.chucker.api.RetentionManager
import com.jayteealao.trails.network.pocket.PocketService
import com.jayteealao.trails.services.semanticSearch.modal.ModalService
import com.skydoves.sandwich.adapters.ApiResponseCallAdapterFactory
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import okhttp3.ConnectionPool
import okhttp3.ConnectionSpec
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Qualifier
import javax.inject.Singleton

private const val DEFAULT_BROWSER_VERSION = "100.0.0.0"

internal const val CHROME_USER_AGENT = "Mozilla/5.0 (Linux; Android 11; Build/RQ2A.210505.003) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Version/4.0 Chrome/$DEFAULT_BROWSER_VERSION Mobile Safari/537.36"

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides
    @Singleton
    fun provideChuckerInterceptor(@ApplicationContext context: Context): ChuckerInterceptor {
        // Create the Collector
        val chuckerCollector = ChuckerCollector(
            context = context,
            // Toggles visibility of the notification
            showNotification = true,
            // Allows to customize the retention period of collected data
            retentionPeriod = RetentionManager.Period.ONE_HOUR
        )

        // Create the Interceptor
        return ChuckerInterceptor.Builder(context)
            // The previously created Collector
            .collector(chuckerCollector)
            // The max body content length in bytes, after this responses will be truncated.
            .maxContentLength(250_000L)
            // List of headers to replace with ** in the Chucker UI
//            .redactHeaders("Auth-Token", "Bearer")
            // Read the whole response body even when the client does not consume the response completely.
            // This is useful in case of parsing errors or when the response body
            // is closed before being read like in Retrofit with Void and Unit types.
            .alwaysReadResponseBody(true)
            // Use decoder when processing request and response bodies. When multiple decoders are installed they
            // are applied in an order they were added.
//            .addBodyDecoder(decoder)
            // Controls Android shortcut creation. Available in SNAPSHOTS versions only at the moment
//            .createShortcut(true)
            .build()
    }

    @Provides
    @Singleton
    fun provideOkHttpClient(
        chuckerInterceptor: ChuckerInterceptor,
    ): OkHttpClient {
        return OkHttpClient.Builder()
            .followRedirects(true)
            .followSslRedirects(true)
            .connectionSpecs(listOf(ConnectionSpec.CLEARTEXT,  ConnectionSpec.MODERN_TLS, ConnectionSpec.COMPATIBLE_TLS))
            .connectionPool(ConnectionPool(20, 5, TimeUnit.MINUTES))
            .hostnameVerifier(OkHttpClient().hostnameVerifier)
            .addNetworkInterceptor { chain ->
                chain.proceed(
                    chain.request().newBuilder()
                        .header("User-Agent", CHROME_USER_AGENT).build()
                )
            }
            .addInterceptor(HttpRequestInterceptor())
            .addInterceptor(chuckerInterceptor)
            .connectTimeout(90, TimeUnit.SECONDS)
            .readTimeout(90, TimeUnit.SECONDS)
            .writeTimeout(90, TimeUnit.SECONDS)
//            .addInterceptor(CoroutineCallInterceptor())
            .build()
    }

    @Provides
    @Singleton
    fun providePocketService(okHttpClient: OkHttpClient): PocketService {
        val retrofit = Retrofit.Builder()
            .client(okHttpClient)
            .baseUrl("https://getpocket.com/v3/")
            .addConverterFactory(GsonConverterFactory.create())
            .addCallAdapterFactory(ApiResponseCallAdapterFactory.create())
            .build()
        return retrofit.create(PocketService::class.java)
    }

    @Provides
    @Singleton
    fun provideModalService(okHttpClient: OkHttpClient): ModalService {
        val retrofit = Retrofit.Builder()
            .client(okHttpClient)
//            .baseUrl("https://jayteealao--example-get-started-app-dev.modal.run")
//            .baseUrl("https://jayteealao--ollama-server-ollama-app-dev.modal.run")
            .baseUrl("https://jayteealao--trails-app-ollama-app-dev.modal.run")
            .addConverterFactory(GsonConverterFactory.create())
            .addCallAdapterFactory(ApiResponseCallAdapterFactory.create())
            .build()
        return retrofit.create(ModalService::class.java)
    }
}

internal class HttpRequestInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()
        val request = originalRequest
            .newBuilder().apply {
                url(originalRequest.url)
                headers(originalRequest.headers)
                if (originalRequest.url.host.contains("getpocket.com") && originalRequest.url.encodedPath.contains("v3")) {
                    addHeader("X-Accept", "application/json")
                    addHeader("Content-Type", "application/json; charset=UTF-8")
                }
                if (originalRequest.url.host.contains("modal.run")) {
                    addHeader("X-Accept", "application/json")
                    addHeader("Content-Type", "application/json")
                }
            }.build()
//        Timber.d(request.toString())
//        Timber.d(request.headers.toString())
        return chain.proceed(request)
    }
}

class CoroutineCallInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val response: Response

        runBlocking(Dispatchers.IO) {
            response = chain.proceed(request)
        }

        return response
    }
}


@Qualifier
@Retention(AnnotationRetention.RUNTIME)
annotation class Services(val retrofitService: RetrofitServices)

enum class RetrofitServices {
    POCKET,
    MODAL
}
