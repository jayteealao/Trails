package com.jayteealao.shared

import com.github.jayteealao.extractorjvm.ExtractData
import com.github.jayteealao.extractorjvm.ExtractorService

class RealExtractorService: ExtractorService {
    override fun extract(): ExtractData {
        return ExtractData("Hello from The OutSide")
    }
}