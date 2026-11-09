// Fixture: the app's article model, as the drift check reads it. It carries no
// server-owned link field.
data class Article(
    val itemId: String,
    val url: String,
)
