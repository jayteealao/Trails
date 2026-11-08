// Fixture: the app's backup writer, as the drift check reads it. It writes no
// marker and no server-owned link field.
fun backupFields(itemId: String, url: String): Map<String, Any?> =
    mapOf("itemId" to itemId, "url" to url)
