import org.jetbrains.kotlin.gradle.plugin.PLUGIN_CLASSPATH_CONFIGURATION_NAME

@Suppress("DSL_SCOPE_VIOLATION") // TODO: Remove once KTIJ-19369 is fixed
plugins {
    kotlin("multiplatform")
    kotlin("plugin.serialization")
    id("app.cash.zipline")
}

kotlin {
    js {
        browser()
        binaries.executable()
    }

    sourceSets {
        commonMain {
            dependencies {
                implementation(libs.zipline)
                implementation(project(":ExtractorCommon"))
            }
        }
    }
}

val compilerConfiguration by configurations.creating {
}

dependencies {
    add(PLUGIN_CLASSPATH_CONFIGURATION_NAME, libs.ziplineKotlinPlugin)
    compilerConfiguration(libs.ziplineGradlePlugin) {
        exclude(module = libs.kotlinGradlePlugin.get().module.name)
    }
}

zipline {
    mainFunction.set("com.jayteealao.shared.launchZipline")
}