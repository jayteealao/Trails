package com.github.jayteealao.extractorjvm

import app.cash.zipline.ZiplineService
import kotlinx.serialization.Serializable

interface ExtractorService: ZiplineService {
    fun extract(): ExtractData
}

@Serializable
data class ExtractData(
    val text: String,
)
