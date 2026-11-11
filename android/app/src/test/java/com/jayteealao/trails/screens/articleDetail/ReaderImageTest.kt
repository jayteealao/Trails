package com.jayteealao.trails.screens.articleDetail

import org.intellij.markdown.MarkdownElementTypes
import org.intellij.markdown.ast.ASTNode
import org.intellij.markdown.flavours.gfm.GFMFlavourDescriptor
import org.intellij.markdown.parser.MarkdownParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File

/** Finding the image of a paragraph and its alt text, and the words of the broken-image placeholder. */
class ReaderImageTest {

    private fun paragraphOf(markdown: String): ASTNode =
        MarkdownParser(GFMFlavourDescriptor()).buildMarkdownTreeFromString(markdown)
            .children.first { it.type == MarkdownElementTypes.PARAGRAPH }

    private fun standalone(markdown: String): ImageRef? = standaloneImageOf(paragraphOf(markdown), markdown)

    @Test
    fun `a paragraph that holds only an image is a figure with its link and alt`() {
        assertEquals(
            ImageRef(link = "https://images.example.invalid/map.png", alt = "A map of the 212 survey blocks"),
            standalone("![A map of the 212 survey blocks](https://images.example.invalid/map.png)"),
        )
    }

    @Test
    fun `spaces around the image keep it a figure`() {
        assertEquals(
            ImageRef(link = "https://images.example.invalid/map.png", alt = "A map of the 212 survey blocks"),
            standalone("  ![A map of the 212 survey blocks](https://images.example.invalid/map.png)  "),
        )
    }

    @Test
    fun `an image inside running text is not a figure`() {
        assertNull(standalone("See ![a](x.png) here"))
    }

    @Test
    fun `a paragraph of text is not a figure`() {
        assertNull(standalone("Forty volunteers split the city into 212 blocks."))
    }

    @Test
    fun `an image with an empty alt has no alt`() {
        assertEquals(ImageRef(link = "x.png", alt = null), standalone("![](x.png)"))
    }

    @Test
    fun `two images in one paragraph are not one figure`() {
        assertNull(standalone("![a](x.png) ![b](y.png)"))
    }

    @Test
    fun `the alt of an image is found by its link`() {
        val markdown = "text ![Lime tree](x.png) more"
        val paragraph = paragraphOf(markdown)
        assertEquals("Lime tree", imageAltFor("x.png", paragraph, markdown))
        assertNull(imageAltFor("y.png", paragraph, markdown))
    }

    @Test
    fun `the placeholder names the image by its alt`() {
        assertEquals("Image did not load: A map", brokenImageLabel("A map"))
        assertEquals("Image did not load", brokenImageLabel(null))
        assertEquals("Image did not load", brokenImageLabel("  "))
    }

    @Test
    fun readerImageModel_loadsWebImagesAndTheAppsOwnFilesOnly() {
        val files = java.nio.file.Files.createTempDirectory("files").toFile()
        val own = File(files, "reader-fixture/figure.png").toURI().toString()
        assertEquals("https://x.example/a.png", readerImageModel("https://x.example/a.png", files))
        assertEquals("http://x.example/a.png", readerImageModel("http://x.example/a.png", files))
        assertEquals(own, readerImageModel(own, files))
        assertNull(readerImageModel(File(files.parentFile, "other/secret.png").toURI().toString(), files))
        assertNull(readerImageModel("content://contacts/photo/1", files))
        assertNull(readerImageModel("android.resource://com.x/1", files))
        assertNull(readerImageModel("javascript:alert(1)", files))
        assertNull(readerImageModel("not a link", files))
    }
}
