package com.jayteealao.trails.common

import io.viascom.nanoid.NanoId

fun generateId(): String = NanoId.generate(14)