package com.jayteealao.trails.services.firestore

// Fixture: the stored names of the user article, as the drift check reads them.
internal data class UserArticleWire(
    val url: String? = null,
    val title: String = "",
) {
    companion object {
        const val URL = "url"
        const val TITLE = "title"
        const val FAVORITE = "favorite"
        const val STATUS = "status"
        const val TIME_ADDED = "timeAdded"
        const val TIME_READ = "timeRead"
        const val TIME_UPDATED = "timeUpdated"
        const val DELETED_AT = "deletedAt"
    }
}
