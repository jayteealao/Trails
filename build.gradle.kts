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

// Root build.gradle.kts

plugins {
    id("com.android.application") version "8.2.2" apply false
    id("org.jetbrains.kotlin.android") version libs.versions.kotlin.get() apply false
    id("org.jetbrains.kotlin.kapt") version "1.8.10" apply false
    id("com.google.dagger.hilt.android") version libs.versions.hilt.get() apply false
    id("com.google.devtools.ksp") version libs.versions.ksp.get() apply false
    id("land.sungbin.composeinvestigator") version "1.5.10-0.1.0"
    id(libs.plugins.kotlin.serialization.get().pluginId) version libs.versions.kotlin.get() apply false
    alias(libs.plugins.kotlin.compose) version libs.versions.kotlin.get() apply false
    alias(libs.plugins.android.test) apply false
}

tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>() {
    compilerOptions.freeCompilerArgs.addAll(
        "-P",
        "plugin:androidx.compose.compiler.plugins.kotlin:experimentalStrongSkipping=true",
    )
}
//repositories {
//    maven {
//        url = java.net.URI("https://services.gradle.org/distributions/")
//    }
//    maven {
//        url = java.net.URI("https://maven.google.com")
//    }
//}

