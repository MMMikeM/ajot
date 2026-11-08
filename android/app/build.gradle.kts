plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.plugin.compose")
}

// One APK per server: a self-hoster's fork sets its own URL and signing key
val serverUrl = (System.getenv("AJOT_SERVER_URL") ?: "https://ajot.fly.dev").trimEnd('/')

android {
  namespace = "app.ajot"
  compileSdk = 36

  defaultConfig {
    applicationId = System.getenv("ANDROID_PACKAGE_NAME") ?: "app.ajot.poc"
    minSdk = 24
    targetSdk = 36
    versionCode = (System.getenv("VERSION_CODE") ?: "1").toInt()
    versionName = "0.0.${System.getenv("VERSION_CODE") ?: "1"}-poc"

    manifestPlaceholders["host"] = java.net.URI(serverUrl).host
    resValue("string", "launchUrl", "$serverUrl/")
    // Quotes escaped for a string resource, which drops bare ones
    resValue(
      "string",
      "assetStatements",
      """[{\"relation\": [\"delegate_permission/common.handle_all_urls\"], \"target\": {\"namespace\": \"web\", \"site\": \"$serverUrl\"}}]""",
    )
    buildConfigField("String", "SERVER_URL", "\"$serverUrl\"")
  }

  buildFeatures {
    compose = true
    buildConfig = true
    resValues = true
  }

  signingConfigs {
    create("release") {
      System.getenv("ANDROID_KEYSTORE_PATH")?.let { path ->
        storeFile = file(path)
        storeType = "pkcs12"
        storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
        keyAlias = System.getenv("ANDROID_KEY_ALIAS") ?: "ajot"
        keyPassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
      }
    }
  }

  buildTypes {
    release {
      signingConfig = signingConfigs.getByName("release")
    }
  }
}

dependencies {
  implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.7.4")
  implementation("androidx.glance:glance-appwidget:1.2.0")
  implementation("androidx.datastore:datastore-preferences:1.3.0")
}
