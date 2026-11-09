// Fixture: the app's archive reader, as the drift check reads it.
private const val CANONICAL_ID_FIELD = "canonicalId"

data class WargMetadata(
    val title: String?,
    val excerpt: String?,
    val byline: String?,
    val wordCount: Int?,
    val leadImage: String?,
)

fun parseMetadata(metadata: Map<String, Any?>): WargMetadata =
    WargMetadata(
        title = metadata["title"] as? String,
        excerpt = metadata["excerpt"] as? String,
        byline = metadata["byline"] as? String,
        wordCount = (metadata["word_count"] as? Number)?.toInt(),
        leadImage = metadata["lead_image"] as? String,
    )
