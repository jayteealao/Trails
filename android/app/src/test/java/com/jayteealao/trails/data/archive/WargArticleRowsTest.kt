package com.jayteealao.trails.data.archive

import com.jayteealao.trails.network.ArticleAuthors
import com.jayteealao.trails.network.ArticleImages
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The pure rules that turn Warg's metadata into the article's lead-image row and
 * byline row, and the lead-image-first choice of the displayed article image.
 */
class WargArticleRowsTest {

    private val lead = "https://example.com/lead.jpg"

    private fun metadata(leadImage: String? = lead, byline: String? = "Jo Writer") = WargMetadata(
        title = "T",
        excerpt = null,
        byline = byline,
        wordCount = 120,
        leadImage = leadImage,
    )

    private fun importedImage() = ArticleImages(
        imageId = "1",
        itemId = "a1",
        src = "https://example.com/imported.jpg",
        width = 100,
        height = 50,
        credit = "",
        caption = "",
    )

    private fun importedAuthor() = ArticleAuthors(
        authorId = "77",
        itemId = "a1",
        name = "Imported Author",
        url = "",
        domain = null,
        image = null,
        bio = null,
        twitter = null,
    )

    // ── usableLeadImage ─────────────────────────────────────────────────

    @Test
    fun usableLeadImage_keepsHttpAndHttpsTrimmed() {
        assertEquals("https://a/b.jpg", usableLeadImage("https://a/b.jpg"))
        assertEquals("http://a/b.jpg", usableLeadImage("  http://a/b.jpg "))
        assertEquals("HTTPS://a/b.jpg", usableLeadImage("HTTPS://a/b.jpg"))
    }

    @Test
    fun usableLeadImage_rejectsOtherSchemesAndBlanks() {
        assertNull(usableLeadImage("data:image/png;base64,AAA"))
        assertNull(usableLeadImage("javascript:alert(1)"))
        assertNull(usableLeadImage("ftp://a/b.jpg"))
        assertNull(usableLeadImage("/relative/b.jpg"))
        assertNull(usableLeadImage(""))
        assertNull(usableLeadImage("  "))
        assertNull(usableLeadImage(null))
    }

    // ── planWargRows ────────────────────────────────────────────────────

    @Test
    fun planWargRows_noRows_writesOneLeadImageRowAndOneBylineRow() {
        val plan = planWargRows("a1", metadata(), null, emptyList(), emptyList())

        assertEquals(listOf(ArticleImages("lead", "a1", lead, 0, 0, "", "")), plan.images)
        assertEquals(
            listOf(ArticleAuthors("a1:byline", "a1", "Jo Writer", "", null, null, null, null)),
            plan.authors,
        )
        assertEquals(ImageChoice.UseLeadImage(lead), plan.image)
    }

    @Test
    fun planWargRows_blankByline_writesNoAuthorRow() {
        val plan = planWargRows("a1", metadata(byline = "  "), null, emptyList(), emptyList())

        assertTrue(plan.authors.isEmpty())
        assertEquals(1, plan.images.size)
    }

    @Test
    fun planWargRows_noLeadImage_writesNoImageRowAndTakesTheScreenshot() {
        val plan = planWargRows("a1", metadata(leadImage = null), null, emptyList(), emptyList())

        assertTrue(plan.images.isEmpty())
        assertEquals(1, plan.authors.size)
        assertEquals(ImageChoice.UseScreenshot, plan.image)
    }

    @Test
    fun planWargRows_unusableLeadImage_isTreatedAsNoLeadImage() {
        val plan = planWargRows("a1", metadata(leadImage = "ftp://x/y.jpg"), null, emptyList(), emptyList())

        assertTrue(plan.images.isEmpty())
        assertEquals(ImageChoice.UseScreenshot, plan.image)
    }

    @Test
    fun planWargRows_identicalRowsStored_writesNothing() {
        val first = planWargRows("a1", metadata(), null, emptyList(), emptyList())

        val second = planWargRows("a1", metadata(), lead, first.images, first.authors)

        assertTrue(second.images.isEmpty())
        assertTrue(second.authors.isEmpty())
        assertEquals(ImageChoice.Keep, second.image)
    }

    @Test
    fun planWargRows_leadRowWithAnotherSrc_writesOneUpdatedRow() {
        val stale = ArticleImages("lead", "a1", "https://example.com/old.jpg", 0, 0, "", "")

        val plan = planWargRows("a1", metadata(), stale.src, listOf(stale), emptyList())

        assertEquals(listOf(ArticleImages("lead", "a1", lead, 0, 0, "", "")), plan.images)
        assertEquals(ImageChoice.UseLeadImage(lead), plan.image)
    }

    @Test
    fun planWargRows_importedImageRow_writesNoImageRowAndKeepsTheImage() {
        val plan = planWargRows("a1", metadata(), importedImage().src, listOf(importedImage()), emptyList())

        assertTrue(plan.images.isEmpty())
        assertEquals(ImageChoice.Keep, plan.image)
        assertEquals(1, plan.authors.size)
    }

    @Test
    fun planWargRows_importedAuthorRow_writesNoAuthorRow() {
        val plan = planWargRows("a1", metadata(), null, emptyList(), listOf(importedAuthor()))

        assertTrue(plan.authors.isEmpty())
        assertEquals(1, plan.images.size)
    }

    @Test
    fun planWargRows_severalNames_stayOneRow() {
        val plan = planWargRows("a1", metadata(byline = " A, B and C "), null, emptyList(), emptyList())

        assertEquals(1, plan.authors.size)
        assertEquals("A, B and C", plan.authors.single().name)
        assertEquals("a1:byline", plan.authors.single().authorId)
    }

    // ── chooseArticleImage (lead image first, screenshot as the fall-back) ──

    @Test
    fun chooseArticleImage_leadImagePresent_usesTheLeadImage() {
        assertEquals(ImageChoice.UseLeadImage(lead), chooseArticleImage(null, lead, false))
        assertEquals(
            ImageChoice.UseLeadImage(lead),
            chooseArticleImage("data:image/jpeg;base64,AAA", lead, false),
        )
    }

    @Test
    fun chooseArticleImage_noLeadImageAndBlankImage_usesTheScreenshot() {
        assertEquals(ImageChoice.UseScreenshot, chooseArticleImage(null, null, false))
        assertEquals(ImageChoice.UseScreenshot, chooseArticleImage("  ", null, false))
    }

    @Test
    fun chooseArticleImage_noLeadImageAndAnImage_keepsIt() {
        assertEquals(ImageChoice.Keep, chooseArticleImage("https://example.com/unfurl.jpg", null, false))
    }

    @Test
    fun chooseArticleImage_leadEqualsCurrent_keeps() {
        assertEquals(ImageChoice.Keep, chooseArticleImage(lead, lead, false))
    }

    @Test
    fun chooseArticleImage_importedRows_keep() {
        assertEquals(ImageChoice.Keep, chooseArticleImage(null, lead, true))
        assertEquals(ImageChoice.Keep, chooseArticleImage(null, null, true))
    }
}
