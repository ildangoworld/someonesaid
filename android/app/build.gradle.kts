import java.net.URI

plugins {
    id("com.android.application")
}

val defaultServer = providers.gradleProperty("haruServer")
    .orElse(providers.environmentVariable("HARU_ANDROID_SERVER"))
    .orElse("")
    .get()
    .trim()
val defaultOrigin = if (defaultServer.isEmpty()) "" else {
    val uri = URI(defaultServer)
    require(uri.scheme == "https" && uri.host != null && uri.rawUserInfo == null &&
        uri.rawQuery == null && uri.rawFragment == null && uri.port != 0 && uri.port <= 65535 &&
        uri.rawPath in listOf("", "/")
    ) { "haruServer must be an HTTPS origin, such as https://quotes.example.com" }
    uri.toASCIIString().removeSuffix("/").lowercase()
}

android {
    namespace = "app.haru.quote"
    compileSdk = 36
    buildToolsVersion = "36.0.0"

    defaultConfig {
        applicationId = "app.haru.quote"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String", "DEFAULT_SERVER", "\"$defaultOrigin\"")
    }

    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets.getByName("main").assets.srcDirs(
        rootProject.file("../shared"),
        rootProject.file("../web/assets"),
    )
}

dependencies {
    implementation("androidx.activity:activity:1.10.1")
}
