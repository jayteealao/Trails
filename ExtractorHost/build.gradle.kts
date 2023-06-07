plugins {
    kotlin("jvm")
    kotlin("plugin.serialization")
    id("app.cash.zipline")
}

dependencies {
    implementation(libs.zipline)
    implementation(libs.zipline.loader)
    implementation(libs.okhttp)
    implementation(libs.okio)
    implementation(project(":ExtractorCommon"))
}
