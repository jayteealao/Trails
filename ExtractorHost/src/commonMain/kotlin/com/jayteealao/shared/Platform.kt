package com.jayteealao.shared

interface Platform {
    val name: String
}

expect fun getPlatform(): Platform