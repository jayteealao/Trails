package com.jayteealao.trails.common

import io.viascom.nanoid.NanoId
import java.security.MessageDigest
import java.security.SecureRandom

fun generateId(): String = NanoId.generate(14)

fun generateDeterministicNanoId(input: String): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val seed = digest.digest(input.toByteArray())
//    val hashString = hashBytes.fold("") { str, it -> str + "%02x".format(it) } // Convert to hex string


    // Use the hash as a seed for NanoID
    val random = SecureRandom(seed)
    return NanoId.generate(size = 14, random = random) // Specify desired length
}