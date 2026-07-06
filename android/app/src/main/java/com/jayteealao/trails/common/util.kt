package com.jayteealao.trails.common

import io.viascom.nanoid.NanoId
import java.security.MessageDigest
import java.security.SecureRandom

private const val ALPHANUMERIC_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

fun generateId(): String = NanoId.generate(size = 14, alphabet = ALPHANUMERIC_ALPHABET)

fun generateDeterministicNanoId(input: String): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val seed = digest.digest(input.toByteArray())
    val random = SecureRandom(seed)
    return NanoId.generate(size = 14, alphabet = ALPHANUMERIC_ALPHABET, random = random)
}
