package com.jayteealao.trails

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Pins the network trust and backup resources: every build trusts only system CAs (debug builds
 * add user CAs), and no app data leaves the device through cloud backup, device transfer or the
 * pre-Android 12 full backup.
 */
class SecurityConfigXmlTest {

    private val xmlDir = File("src/main/res/xml")
    private val excludedDomains = setOf("root", "file", "database", "sharedpref", "external")

    private fun parse(name: String): Element =
        DocumentBuilderFactory.newInstance().newDocumentBuilder()
            .parse(File(xmlDir, name))
            .documentElement

    private fun Element.children(tag: String): List<Element> =
        (0 until childNodes.length).map { childNodes.item(it) }
            .filterIsInstance<Element>()
            .filter { it.tagName == tag }

    private fun Element.single(tag: String): Element =
        children(tag).also { assertEquals("one <$tag> under <$tagName>", 1, it.size) }.first()

    private fun Element.certificateSources(): List<String> =
        single("trust-anchors").children("certificates").map { it.getAttribute("src") }

    @Test
    fun `release trusts system CAs only and permits cleartext`() {
        val baseConfig = parse("network_security_config.xml").single("base-config")

        assertEquals("true", baseConfig.getAttribute("cleartextTrafficPermitted"))
        assertEquals(listOf("system"), baseConfig.certificateSources())
    }

    @Test
    fun `debug builds add user CAs`() {
        val debugOverrides = parse("network_security_config.xml").single("debug-overrides")

        assertEquals(listOf("user"), debugOverrides.certificateSources())
    }

    @Test
    fun `cloud backup and device transfer exclude every domain`() {
        val rules = parse("data_extraction_rules.xml")

        assertExcludesEverything(rules.single("cloud-backup"))
        assertExcludesEverything(rules.single("device-transfer"))
    }

    @Test
    fun `full backup excludes every domain`() {
        val rules = parse("backup_rules.xml")

        assertEquals("full-backup-content", rules.tagName)
        assertExcludesEverything(rules)
    }

    private fun assertExcludesEverything(section: Element) {
        assertTrue("<${section.tagName}> has no include", section.children("include").isEmpty())
        val excludes = section.children("exclude")
        assertEquals(excludedDomains, excludes.map { it.getAttribute("domain") }.toSet())
        assertEquals(excludedDomains.size, excludes.size)
        excludes.forEach { assertEquals(".", it.getAttribute("path")) }
    }
}
