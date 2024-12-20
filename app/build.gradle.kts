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
    compileSdk = 34

    defaultConfig {
        applicationId = "com.jayteealao.trails"
        minSdk = 21
        targetSdk = 33
        versionCode = 1
        versionName = "1.0"

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
            this.isShrinkResources = true
            isDebuggable = false
            signingConfig = signingConfigs.getByName("debug")
//            isProfileable = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
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

    //landscapist
//    implementation(libs.landscapist.coil)
    implementation("io.coil-kt.coil3:coil-compose:3.0.0-rc01")
    implementation("io.coil-kt.coil3:coil-network-okhttp:3.0.0-rc01")
    implementation("com.squareup.okio:okio:3.9.1")

    //profileInstaller
    implementation("androidx.profileinstaller:profileinstaller:1.4.1")

    // Local tests: jUnit, coroutines, Android runner
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)

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
