import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Release signing values come from (in order): env vars, gradle project
// properties, then android/local.properties (gitignored). Loaded once at
// config time. See android/local.properties.example.
val signingProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

fun signingValue(key: String): String? =
    System.getenv(key)?.takeIf { it.isNotBlank() }
        ?: (project.findProperty(key) as? String)?.takeIf { it.isNotBlank() }
        ?: signingProps.getProperty(key)?.takeIf { it.isNotBlank() }

// Release signing inputs. The release keystore signs the AAB and is the next
// signer of the APK; the debug keystore is the APK's original signer, and the
// committed lineage proves the rotation from the debug key to the release key.
val releaseStoreFile = (signingValue("SIGNING_STORE_FILE") ?: signingValue("KEYSTORE_FILE"))
    ?.let { project.file(it) }
val releaseStorePassword = signingValue("SIGNING_STORE_PASSWORD") ?: signingValue("KEYSTORE_PASSWORD")
val releaseKeyAlias = signingValue("SIGNING_KEY_ALIAS")
val releaseKeyPassword = signingValue("SIGNING_KEY_PASSWORD") ?: signingValue("KEYSTORE_PASSWORD")
val debugStoreFile = project.file(
    signingValue("SIGNING_DEBUG_STORE_FILE")
        ?: "${providers.systemProperty("user.home").get()}/.android/debug.keystore"
)
val lineageFile = project.file(signingValue("SIGNING_LINEAGE_FILE") ?: "trails.lineage")

// Every value a release build needs that is absent, by the name to set.
val missingReleaseSigning: List<String> = buildList {
    if (releaseStoreFile?.exists() != true) add("SIGNING_STORE_FILE")
    if (releaseStorePassword == null) add("SIGNING_STORE_PASSWORD")
    if (releaseKeyAlias == null) add("SIGNING_KEY_ALIAS")
    if (releaseKeyPassword == null) add("SIGNING_KEY_PASSWORD")
    if (!debugStoreFile.exists()) add("SIGNING_DEBUG_STORE_FILE")
    if (!lineageFile.exists()) add("SIGNING_LINEAGE_FILE")
}

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
    alias(libs.plugins.hilt.gradle)
    alias(libs.plugins.ksp)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kotlin.compose)
    id("com.google.gms.google-services")
//    id("land.sungbin.composeinvestigator") version "1.5.10-0.1.0"
}

android {
    namespace = "com.jayteealao.trails"
    compileSdk = 37

    signingConfigs {
        create("release") {
            // Values are set only when present. A missing value fails the
            // release build in checkReleaseSigning (below) with one message
            // naming every missing value; there is no fallback to debug signing.
            releaseStoreFile?.takeIf { it.exists() }?.let { storeFile = it }
            releaseStorePassword?.let { storePassword = it }
            releaseKeyAlias?.let { keyAlias = it }
            releaseKeyPassword?.let { keyPassword = it }

            enableV3Signing = true
            enableV4Signing = true
        }
    }

    defaultConfig {
        applicationId = "com.jayteealao.trails"
        minSdk = 24
        targetSdk = 36
        versionCode = 110270
        versionName = "1.10.27"

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
            signingConfig = signingConfigs.getByName("release")

            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )

            // Handle baseline profiles to prevent installation failures
            // Exclude baseline profile files since ProfileInstaller is disabled
            // This prevents INSTALL_BASELINE_PROFILE_FAILED errors during installation
            packaging {
                resources.excludes.add("assets/dexopt/baseline.prof")
                resources.excludes.add("assets/dexopt/baseline.profm")
                resources.excludes.add("META-INF/androidx.profileinstaller_profileinstaller.version")
            }
        }

        getByName("debug") {
            isMinifyEnabled = false
            // Always use debug signing for debug builds
            signingConfig = signingConfigs.getByName("debug")
        }
//        create("benchmark") {
//            initWith(buildTypes.getByName("release"))
//            matchingFallbacks += listOf("release")
//            signingConfig = signingConfigs.getByName("debug")
//        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    testOptions {
        // Steady frames for both JVM (Robolectric) and instrumented Compose tests.
        animationsDisabled = true

        unitTests {
            // Firebase enums (e.g. FirebaseFirestoreException.Code) statically
            // touch android.util.SparseArray; without this their <clinit> throws
            // "not mocked" under plain JVM unit tests.
            isReturnDefaultValues = true
            // Robolectric Compose tests need real Android resources on the JVM
            // classpath to inflate themes/drawables when rendering composables.
            isIncludeAndroidResources = true
        }

        // Gradle Managed Device that AGP auto-provisions for the instrumented
        // characterization suite (Room+Hilt smoke test + NavigationTest). Creates
        // the `pixel36DebugAndroidTest` task. API 36 matches the app's targetSdk,
        // so regenerated Room/Hilt codegen is exercised on the same API the app ships.
        managedDevices {
            localDevices {
                create("pixel36") {
                    device = "Pixel 6"
                    apiLevel = 36
                    systemImageSource = "aosp"
                }
            }
        }
    }

    buildFeatures {
        compose = true
        aidl = false
        buildConfig = true
        renderScript = false
        shaders = false
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
//            excludes += "META-INF/DEPENDENCIES"
        }
    }
}

kotlin {
    jvmToolchain(21)
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
    }
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
    // The `ksp` configuration covers the main source set only: without the
    // kspAndroidTest line, kspDebugAndroidTestKotlin is skipped and every
    // @HiltAndroidTest fails at runtime with a missing
    // <Test>_TestComponentDataSupplier class. Do not register the processor
    // through kapt as well: KSP and kapt would each emit the Hilt factories and
    // fail the build with "duplicate class" errors.
    kspAndroidTest(libs.hilt.compiler)
    androidTestImplementation(libs.hilt.android.testing)
    testImplementation(libs.hilt.android.testing)

    //compose Icons
    implementation(libs.compose.icons.cssgg)

    // Arch Components
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.livedata.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.savedstate)
    implementation(libs.androidx.lifecycle.viewmodel.ktx)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.hilt.navigation.compose)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    implementation(libs.androidx.room.paging)
    implementation(libs.androidx.paging.runtime)
    implementation(libs.androidx.paging.compose)
    ksp(libs.androidx.room.compiler)
    implementation(libs.androidx.startup.runtime)

    //firebase
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.ai)
    implementation(libs.firebase.auth)
    implementation(libs.firebase.firestore)
    implementation(libs.firebase.config)
    implementation(libs.play.services.auth)

    // Navigation 3
    implementation(libs.androidx.navigation3.ui)
    implementation(libs.androidx.navigation3.runtime)
    implementation(libs.androidx.lifecycle.viewmodel.navigation3)
    implementation(libs.androidx.material3.adaptive.navigation3)

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
    testImplementation(libs.androidx.work.testing)

    // Retrofit
    implementation(libs.bundles.retrofit)
    implementation(libs.kotlinx.serialization.json)
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

    //accompanist-webview
    implementation(libs.accompanist.webview)

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

    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.okio)

    // Tartlet - Compose MVVM helper
    implementation(libs.tartlet)

    // Local tests: jUnit, coroutines, Android runner
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation("io.mockk:mockk:1.14.5")
    // JVM Compose characterization (Robolectric renders ArticleListScreenContent in
    // isolation — no emulator, no Hilt). ui-test-manifest supplies the activity that
    // createComposeRule() hosts under Robolectric.
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.compose.ui.test.junit4)
    testImplementation(libs.androidx.compose.ui.test.manifest)
    // Provides Tasks + Task.await() on the unit-test classpath (version-aligned
    // with kotlinx-coroutines-test) so Firestore Task mocks resolve correctly.
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.10.2")

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

// ---- Release signing: fail-closed check ----
// Release builds have no fallback signer: when any signing value is missing,
// the release APK and AAB tasks fail before signing and name every missing
// value. The check hangs on the signing tasks, not on preReleaseBuild, so unit
// tests, debug builds and the pull-request check never need the keys.
abstract class CheckReleaseSigning : DefaultTask() {
    @get:Input
    abstract val missing: ListProperty<String>

    @TaskAction
    fun check() {
        val names = missing.get()
        if (names.isNotEmpty()) {
            throw GradleException(
                "Release signing is not configured. Missing: ${names.joinToString(", ")}. " +
                    "Set them as environment variables, -P properties or in android/local.properties " +
                    "(see android/local.properties.example)."
            )
        }
    }
}

val checkReleaseSigning = tasks.register<CheckReleaseSigning>("checkReleaseSigning") {
    group = "verification"
    description = "Fails when a release signing value is missing."
    missing.set(missingReleaseSigning)
}

tasks.matching { it.name in setOf("validateSigningRelease", "packageRelease", "signReleaseBundle") }
    .configureEach { dependsOn(checkReleaseSigning) }
