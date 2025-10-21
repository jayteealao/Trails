package com.jayteealao.trails.data.models

import androidx.room.Entity
import androidx.room.PrimaryKey
import kotlinx.serialization.Serializable

@Serializable
@Entity
data class ArticleSummary(
    @PrimaryKey val id: String = "",
    val summary: String = "",
)
