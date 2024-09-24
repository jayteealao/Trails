package com.jayteealao.trails.services.semanticSearch.weaviate

import com.jayteealao.trails.data.local.database.PocketArticle
//import io.weaviate.client.Config
//import io.weaviate.client.WeaviateAuthClient
//import io.weaviate.client.WeaviateClient
//import io.weaviate.client.base.Result
//import io.weaviate.client.v1.batch.model.ObjectGetResponse
//import io.weaviate.client.v1.data.api.ObjectCreator
//import io.weaviate.client.v1.data.model.WeaviateObject
//import io.weaviate.client.v1.data.model.WeaviateObject.WeaviateObjectBuilder
//import io.weaviate.client.v1.data.replication.model.ConsistencyLevel
//import io.weaviate.client.v1.schema.model.DataType
//import io.weaviate.client.v1.schema.model.Property
//import io.weaviate.client.v1.schema.model.WeaviateClass
//import javax.inject.Inject
//
//private const val WEAVIATECOLLECTION = "Article"
//
//class WeaviateService @Inject constructor() {
//
//    private val headers = HashMap<String, String>().apply {
//        put("X-Cohere-Api-Key", "nd5ZKaqeRCCvrjdhDk2dr4LJMKS4ysV22H9WdGWf")
//    }
//
//    private val config = Config("https", "test-sandbox-kajqmo8c.weaviate.network", headers)
//
//    private val client: WeaviateClient = WeaviateAuthClient.apiKey(config, "L0JudtqS4uI3hTIuAEBwVwd2fRrHdZf5kTi8")
//
//
//    private val weaviateClass = WeaviateClass.builder()
//        .className(WEAVIATECOLLECTION)
//        .description("A written text, for example a news article or blog post")
//        .vectorizer("text2vec-cohere")
//        .properties(
//            listOf(
//                Property.builder()
//                    .dataType(
//                        listOf (DataType.TEXT))
//                    .description("Title of the article")
//                    .name("title")
//                    .build(),
//                Property.builder()
//                    .dataType(listOf(DataType.TEXT))
//                    .description("The content of the article")
//                    .name("content")
//                    .build()
//                )
//        ).build();
//
//    private val schema = client.schema().classCreator().withClass(weaviateClass)
//
//    fun insertDataObject(article: PocketArticle): Result<WeaviateObject>? {
//
//        return client.data().creator()
//            .withClassName(WEAVIATECOLLECTION)
//            .withID(article.itemId)
//            .withProperties(
//                mapOf(
//                    Pair("title", article.givenTitle),
//                    Pair("content", article.text)
//                )
//            ).run()
//    }
//
//    fun insertDataObjects(articles: List<PocketArticle>): Result<Array<ObjectGetResponse>> {
//        val dataObjects = articles.map {
//            WeaviateObject.builder()
//                .id(it.itemId)
//                .properties(
//                    mapOf(
//                        Pair("title", it.givenTitle),
//                        Pair("content", it.text)
//                    )
//                ).build()
//
//        }
//        return client.batch().objectsBatcher()
//            .withObjects(*dataObjects.toTypedArray())
//            .withConsistencyLevel(ConsistencyLevel.ALL)
//            .run()
//    }
//
//}