import com.android.build.api.artifact.SingleArtifact
import java.io.ByteArrayOutputStream
import java.security.SecureRandom
import java.util.Base64
import java.util.Properties
import javax.inject.Inject
import org.gradle.process.ExecOperations
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

// ---- Release signing: key-rotation re-sign of the APK ----
// AGP has no signing-lineage setting, so after packageRelease this task
// re-signs the release APK with apksigner: the debug key is the original signer
// (v1, v2, v3), the release key is the next signer (v3.1, Android 13 and newer)
// and the committed lineage links them, so a release installs over the debug
// build. It verifies the result before it replaces the APK and its v4 .idsig;
// on any failure it deletes them, so no APK without the lineage is left behind.
// The AAB stays signed by AGP with the release key only.
abstract class ResignReleaseApk @Inject constructor(
    private val exec: ExecOperations,
) : DefaultTask() {
    @get:InputDirectory
    abstract val apkDir: DirectoryProperty

    @get:InputFile
    abstract val debugStore: RegularFileProperty

    @get:InputFile
    abstract val releaseStore: RegularFileProperty

    @get:InputFile
    abstract val lineage: RegularFileProperty

    @get:Input
    abstract val keyAlias: Property<String>

    @get:Internal
    abstract val storePassword: Property<String>

    @get:Internal
    abstract val keyPassword: Property<String>

    @get:Internal
    abstract val apksigner: RegularFileProperty

    @TaskAction
    fun resign() {
        val started = System.nanoTime()
        val apks = apkDir.get().asFile.listFiles { f -> f.name.endsWith(".apk") }.orEmpty()
        val apk = apks.singleOrNull()
            ?: throw GradleException("Expected exactly one release APK in ${apkDir.get().asFile}, found ${apks.size}.")
        val idsig = File(apk.path + ".idsig")
        try {
            val tool = apksigner.get().asFile
            if (!tool.exists()) {
                throw GradleException("apksigner not found at ${tool.path}; install that Android SDK build-tools version.")
            }
            temporaryDir.listFiles()?.forEach { it.deleteRecursively() }
            val signed = File(temporaryDir, apk.name)
            val signedIdsig = File(signed.path + ".idsig")
            apksigner(
                tool, "sign",
                "--ks", debugStore.get().asFile.path, "--ks-key-alias", "androiddebugkey",
                "--ks-pass", "pass:android", "--key-pass", "pass:android",
                "--next-signer",
                "--ks", releaseStore.get().asFile.path, "--ks-key-alias", keyAlias.get(),
                "--ks-pass", "env:TRAILS_RELEASE_STORE_PASS", "--key-pass", "env:TRAILS_RELEASE_KEY_PASS",
                "--lineage", lineage.get().asFile.path,
                "--v1-signing-enabled", "true", "--v2-signing-enabled", "true",
                "--v3-signing-enabled", "true", "--v4-signing-enabled", "true",
                "--lib-page-alignment", "16384",
                "--out", signed.path, apk.path,
            )
            // One verify run covers every scheme, the v4 .idsig included.
            val report = apksigner(tool, "verify", "-v", "--print-certs", "--v4-signature-file", signedIdsig.path, signed.path)
            for (scheme in listOf("v3.1 scheme (APK Signature Scheme v3.1)", "v4 scheme (APK Signature Scheme v4)")) {
                if (report.lines().none { it.trim() == "Verified using $scheme: true" }) {
                    throw GradleException("The re-signed APK is not verified using $scheme:\n$report")
                }
            }
            signed.copyTo(apk, overwrite = true)
            signedIdsig.copyTo(idsig, overwrite = true)
        } catch (e: Exception) {
            apk.delete()
            idsig.delete()
            throw GradleException("Re-signing ${apk.name} with the key-rotation lineage failed; the APK was deleted. ${e.message}", e)
        }
        logger.lifecycle("Re-signed ${apk.name} with the key-rotation lineage in ${(System.nanoTime() - started) / 1_000_000} ms.")
    }

    private fun apksigner(tool: File, vararg args: String): String {
        val out = ByteArrayOutputStream()
        val result = exec.exec {
            commandLine(listOf(tool.path) + args)
            // Release passwords reach apksigner through the environment (env:),
            // never on its command line.
            environment("TRAILS_RELEASE_STORE_PASS", storePassword.get())
            environment("TRAILS_RELEASE_KEY_PASS", keyPassword.get())
            standardOutput = out
            errorOutput = out
            isIgnoreExitValue = true
        }
        val text = out.toString()
        if (result.exitValue != 0) {
            throw GradleException("apksigner ${args.first()} exited with ${result.exitValue}:\n$text")
        }
        return text
    }
}

androidComponents {
    onVariants(selector().withBuildType("release")) { variant ->
        val apksignerName = if (providers.systemProperty("os.name").get().startsWith("Windows")) "apksigner.bat" else "apksigner"
        val buildTools = android.buildToolsVersion
        val resign = tasks.register<ResignReleaseApk>("resignReleaseApk") {
            group = "build"
            description = "Re-signs the release APK with the debug-to-release key-rotation lineage."
            apkDir.set(variant.artifacts.get(SingleArtifact.APK))
            apksigner.set(sdkComponents.sdkDirectory.map { it.file("build-tools/$buildTools/$apksignerName") })
            debugStore.set(debugStoreFile)
            releaseStoreFile?.let { releaseStore.set(it) }
            lineage.set(lineageFile)
            releaseKeyAlias?.let { keyAlias.set(it) }
            releaseStorePassword?.let { storePassword.set(it) }
            releaseKeyPassword?.let { keyPassword.set(it) }
            doNotTrackState("re-signs the packaged APK in place")
        }
        tasks.matching { it.name == "assembleRelease" || it.name == "installRelease" }
            .configureEach { dependsOn(resign) }
    }
}

// ---- Release signing: throwaway-key harness ----
// Generates a debug-like keystore (androiddebugkey / android, like the SDK's
// debug keystore), a release-like and an unrelated keystore with random
// passwords, the lineages debug-like -> release-like (harness.lineage) and
// debug-like -> other (other.lineage), and harness.env with the SIGNING_*
// exports for the harness keys. Everything stays under app/build/ and is
// regenerated on each run; android/scripts/release-signing-harness.sh drives
// the release build against it. The real keystores are never needed.
abstract class GenerateSigningHarness @Inject constructor(
    private val exec: ExecOperations,
) : DefaultTask() {
    @get:OutputDirectory
    abstract val outDir: DirectoryProperty

    @get:Internal
    abstract val keytool: RegularFileProperty

    @get:Internal
    abstract val apksigner: RegularFileProperty

    @TaskAction
    fun generate() {
        val dir = outDir.get().asFile
        dir.listFiles()?.forEach { it.deleteRecursively() }
        val random = SecureRandom()
        fun password() = ByteArray(18).also { random.nextBytes(it) }
            .let { Base64.getUrlEncoder().withoutPadding().encodeToString(it) }
        val passwords = mapOf(
            "HARNESS_DEBUG_PASS" to "android",
            "HARNESS_RELEASE_PASS" to password(),
            "HARNESS_OTHER_PASS" to password(),
        )
        fun run(tool: File, vararg args: String) {
            exec.exec {
                commandLine(listOf(tool.path) + args)
                environment(passwords)
            }
        }
        fun keystore(name: String, alias: String, passVar: String, cn: String) = File(dir, name).also {
            run(
                keytool.get().asFile, "-genkeypair", "-noprompt",
                "-keystore", it.path, "-storetype", "PKCS12", "-alias", alias,
                "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000", "-dname", "CN=$cn",
                "-storepass:env", passVar, "-keypass:env", passVar,
            )
        }
        val debugLike = keystore("debug-like.keystore", "androiddebugkey", "HARNESS_DEBUG_PASS", "Harness Debug")
        val releaseLike = keystore("release-like.jks", "release-like", "HARNESS_RELEASE_PASS", "Harness Release")
        val other = keystore("other.jks", "other", "HARNESS_OTHER_PASS", "Harness Other")
        fun rotate(out: String, next: File, alias: String, passVar: String) = run(
            apksigner.get().asFile, "rotate", "--out", File(dir, out).path,
            "--old-signer", "--ks", debugLike.path, "--ks-key-alias", "androiddebugkey",
            "--ks-pass", "env:HARNESS_DEBUG_PASS", "--key-pass", "env:HARNESS_DEBUG_PASS",
            "--new-signer", "--ks", next.path, "--ks-key-alias", alias,
            "--ks-pass", "env:$passVar", "--key-pass", "env:$passVar",
        )
        rotate("harness.lineage", releaseLike, "release-like", "HARNESS_RELEASE_PASS")
        rotate("other.lineage", other, "other", "HARNESS_OTHER_PASS")
        fun path(f: File) = f.absolutePath.replace('\\', '/')
        File(dir, "harness.env").writeText(
            """
            export SIGNING_STORE_FILE='${path(releaseLike)}'
            export SIGNING_STORE_PASSWORD='${passwords.getValue("HARNESS_RELEASE_PASS")}'
            export SIGNING_KEY_ALIAS='release-like'
            export SIGNING_KEY_PASSWORD='${passwords.getValue("HARNESS_RELEASE_PASS")}'
            export SIGNING_DEBUG_STORE_FILE='${path(debugLike)}'
            export SIGNING_LINEAGE_FILE='${path(File(dir, "harness.lineage"))}'
            """.trimIndent() + "\n"
        )
        logger.lifecycle("Signing harness written to ${path(dir)}")
    }
}

tasks.register<GenerateSigningHarness>("generateSigningHarness") {
    group = "verification"
    description = "Generates throwaway debug-like and release-like keystores and a lineage under app/build/signing-harness."
    val windows = providers.systemProperty("os.name").get().startsWith("Windows")
    val buildTools = android.buildToolsVersion
    outDir.set(layout.buildDirectory.dir("signing-harness"))
    keytool.set(
        layout.file(providers.systemProperty("java.home").map { File(it, if (windows) "bin/keytool.exe" else "bin/keytool") })
    )
    apksigner.set(
        androidComponents.sdkComponents.sdkDirectory
            .map { it.file("build-tools/$buildTools/${if (windows) "apksigner.bat" else "apksigner"}") }
    )
    doNotTrackState("throwaway keys are regenerated on every run")
}
