package com.jayteealao.trails.usecases

import android.content.Intent
import android.net.Uri
import java.net.URLEncoder.encode
import javax.inject.Inject

class AuthorizeTokenUseCase @Inject constructor() {
    operator fun invoke(requestToken: String, redirectUri: String): Intent {
        val authorizationUrl = "https://getpocket.com/auth/authorize?" +
                "request_token=$requestToken&redirect_uri=${
                    encode(redirectUri, "UTF-8")
                }"
        val authIntent = Intent(Intent.ACTION_VIEW).apply {
            data = Uri.parse(authorizationUrl)
        }

        return Intent.createChooser(authIntent, "Authorize Pocket")
    }
}
