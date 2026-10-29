package com.jayteealao.trails.data.local.database

import androidx.paging.PagingSource
import com.jayteealao.trails.data.archive.LocalArchiveDao
import kotlinx.coroutines.flow.Flow
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.lang.reflect.Method
import java.lang.reflect.Modifier
import kotlin.coroutines.Continuation

/**
 * Every database query the app declares either suspends or returns a stream ([Flow] or
 * [PagingSource]), so no query can block the thread that calls it.
 */
class DaoSuspendRuleTest {

    @Test
    fun articleDao_hasNoBlockingQuery() = assertNoBlockingQuery(ArticleDao::class.java)

    @Test
    fun localArchiveDao_hasNoBlockingQuery() = assertNoBlockingQuery(LocalArchiveDao::class.java)

    @Test
    fun rule_rejectsABlockingQuery() {
        val blocking = BlockingSample::class.java.getDeclaredMethod("count")
        val suspending = BlockingSample::class.java.declaredMethods.single { it.name == "load" }

        assertFalse(isNonBlocking(blocking))
        assertTrue(isNonBlocking(suspending))
    }

    private fun assertNoBlockingQuery(dao: Class<*>) {
        val queries = dao.declaredMethods.filter { Modifier.isAbstract(it.modifiers) && !it.isSynthetic }
        assertTrue("${dao.simpleName} declares no query", queries.isNotEmpty())

        val blocking = queries.filterNot(::isNonBlocking).map { it.name }.sorted()
        assertTrue("${dao.simpleName} has blocking queries: $blocking", blocking.isEmpty())
    }

    private fun isNonBlocking(method: Method): Boolean =
        method.parameterTypes.lastOrNull() == Continuation::class.java ||
            Flow::class.java.isAssignableFrom(method.returnType) ||
            PagingSource::class.java.isAssignableFrom(method.returnType)

    private interface BlockingSample {
        fun count(): Int
        suspend fun load(): Int
    }
}
