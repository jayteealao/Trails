package com.jayteealao.shared

import app.cash.zipline.Zipline
import com.github.jayteealao.extractorjvm.ExtractorService

@OptIn(ExperimentalJsExport::class)
@JsExport
fun launchZipline() {
    val zipline = Zipline.get()
    zipline.bind<ExtractorService>("extractorService", RealExtractorService() )
}