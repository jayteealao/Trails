/*
 * Copyright (C) 2022 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

//@Suppress("DSL_SCOPE_VIOLATION") // Remove when fixed https://youtrack.jetbrains.com/issue/KTIJ-19369
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.kapt)
    alias(libs.plugins.hilt.gradle)
    alias(libs.plugins.ksp)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kotlin.compose)
//    id("land.sungbin.composeinvestigator") version "1.5.10-0.1.0"
}

android {
    namespace = "com.jayteealao.trails"
    compileSdk = 36

    signingConfigs {
        create("release") {
            val storeFilePath = System.getenv("SIGNING_STORE_FILE").orEmpty()
            val hasEnvKeystore = storeFilePath.isNotBlank() && project.file(storeFilePath).exists()

            if (hasEnvKeystore) {
                // Use environment variables (CI/CD)
                storeFile = project.file(storeFilePath)
                storePassword = System.getenv("SIGNING_STORE_PASSWORD")
                keyAlias = System.getenv("SIGNING_KEY_ALIAS")
                keyPassword = System.getenv("SIGNING_KEY_PASSWORD")
            } else if (project.hasProperty("KEYSTORE_FILE")) {
                // Get from gradle.properties for local testing
                val keystorePath = project.property("KEYSTORE_FILE") as String
                val keystoreFile = file(keystorePath)

                if (keystoreFile.exists()) {
                    storeFile = keystoreFile
                    storePassword = project.property("KEYSTORE_PASSWORD") as String
                    keyAlias = project.property("SIGNING_KEY_ALIAS") as String
                    keyPassword = project.property("SIGNING_KEY_PASSWORD") as String
                } else {
                    // Keystore file doesn't exist - use debug signing
                    println("WARNING: Release keystore not found at $keystorePath. Using debug signing.")
                    storeFile = null
                }
            } else {
                // No signing configuration available - will use debug signing
                println("WARNING: No release signing configuration found. Using debug signing.")
                storeFile = null
            }

            enableV3Signing = true
            enableV4Signing = true
        }
    }

    defaultConfig {
        applicationId = "com.jayteealao.trails"
        minSdk = 23
        targetSdk = 33
        versionCode = 10206
        versionName = "1.2.6"

        testInstrumentationRunner = "com.jayteealao.trails.HiltTestRunner"
        vectorDrawables {
            useSupportLibrary = true
        }

        // Enable room auto-migrations
        ksp {
            arg("room.schemaLocation", "$projectDir/schemas")
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = true
            isShrinkResources = true
            isDebuggable = false
//            isProfileable = true

            // Use release signing if available, otherwise fall back to debug signing
            val releaseSigningConfig = signingConfigs.findByName("release")
            if (releaseSigningConfig?.storeFile != null) {
                signingConfig = releaseSigningConfig
                println("Using release signing configuration")
            } else {
                signingConfig = signingConfigs.getByName("debug")
                println("WARNING: Using debug signing for release build")
            }

            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }

        getByName("debug") {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
        create("benchmark") {
            initWith(buildTypes.getByName("release"))
            matchingFallbacks += listOf("release")
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
        freeCompilerArgs = listOf("-Xcontext-receivers")
    }

    buildFeatures {
        compose = true
        aidl = false
        buildConfig = false
        renderScript = false
        shaders = false
    }

    composeOptions {
        kotlinCompilerExtensionVersion = libs.versions.androidxComposeCompiler.get()
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
//            excludes += "META-INF/DEPENDENCIES"
        }
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui.graphics)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    //    implementation(libs.androidx.constraintlayout)
    val composeBom = platform(libs.androidx.compose.bom)
    implementation(composeBom)
    androidTestImplementation(composeBom)

    // Core Android dependencies
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)

    // Hilt Dependency Injection
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    // Hilt and instrumented tests.
    androidTestImplementation(libs.hilt.android.testing)
    kaptAndroidTest(libs.hilt.android.compiler)
    // Hilt and Robolectric tests.
    testImplementation(libs.hilt.android.testing)
    kaptTest(libs.hilt.android.compiler)

    //compose Icons
    implementation(libs.compose.icons.cssgg)

    // Arch Components
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.livedata.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.savedstate)
    implementation(libs.androidx.lifecycle.viewmodel.ktx)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.hilt.navigation.compose)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    implementation(libs.androidx.room.paging)
    implementation(libs.androidx.paging.runtime)
    implementation(libs.androidx.paging.compose)
    ksp(libs.androidx.room.compiler)
    implementation(libs.androidx.startup.runtime)

    // Compose
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui.fonts)
    // Tooling
    debugImplementation(libs.androidx.compose.ui.tooling)
    // Instrumented tests
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    debugImplementation(libs.androidx.compose.ui.test.manifest)

    // WorkManager
    implementation(libs.bundles.work)
    implementation(libs.androidx.hilt.work)
    ksp(libs.androidx.hilt.hilt.compiler)
//    annotationProcessor(libs.androidx.hilt.hilt.compiler)
    androidTestImplementation(libs.androidx.work.testing)

    // Retrofit
    implementation(libs.bundles.retrofit)
    //okhttp
    implementation(libs.okhttp)
//    {
        //noinspection DuplicatePlatformClasses
//        exclude(group = "org.apache.httpcomponents", module = "httpcore")
//        exclude(group = "org.apache.httpcomponents", module = "httpclient")
//    }

//    splashscreen
    implementation(libs.splashscreen)

//    timber
    implementation(libs.timber)

//    chucker
    debugImplementation(libs.chucker)
    releaseImplementation( libs.chucker.no.op)

    //chrome custom tabs
    implementation(libs.chromeCustomTabs)

    //essence
    implementation(libs.essence)
    //crux
    implementation(libs.crux)  // See the latest version number above.
    //jreadability
    implementation(libs.readability4j)
    //accompanist-webview
    implementation(libs.accompanist.webview)

    //supabase
    implementation(libs.supabase.postgrest)
    implementation(libs.supabase.realtime)
    implementation(libs.supabase.gotrue)
    //ktor
    implementation(libs.ktor)
    //weaviate
//    implementation(libs.weaviate.client) {
        //noinspection DuplicatePlatformClasses
//        exclude(group = "org.apache.httpcomponents", module = "httpcore")
//    }

//    shadowsPlus
    implementation(libs.shadows.plus)

    //markdown-renderer
    implementation(libs.markdown.renderer)
    implementation(libs.markdown.renderer.m3)
    implementation(libs.markdown.renderer.coil3)

    //constraint-layout
    implementation(libs.constraint.layout)

    //unfurl
    implementation(libs.unfurl)

    //nanoid
    implementation(libs.nanoid)

//    implementation(libs.postgrest)
    //landscapist
//    implementation(libs.landscapist.coil)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.okio)

    // jetpack pallete
    implementation(libs.androidx.palette.ktx)

    //swipe-to-reveal
    implementation("me.saket.swipe:swipe:1.2.0")

    //profileInstaller
    implementation(libs.androidx.profileinstaller)

    // Local tests: jUnit, coroutines, Android runner
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation("io.mockk:mockk:1.14.5")

    // Instrumented tests: jUnit rules and runners

    androidTestImplementation(libs.androidx.test.core)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.runner)

//    implementation("org.apache.httpcomponents:httpclient:4.5.14")
//    implementation("org.apache.httpcomponents:httpcore:4.4.16")

//    configurations.all {
//        resolutionStrategy {
//            failOnVersionConflict()
//        }
//    }
}
