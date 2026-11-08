import java.net.URI

plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.plugin.compose")
}

// One APK per server: a self-hoster's fork sets its own URL and signing key
val serverUrl = (System.getenv("AJOT_SERVER_URL") ?: "https://ajot.fly.dev").trimEnd('/')

// The PWA's share_target (packages/client/vite.config.ts): Chrome hands a share to the TWA only
// with a copy of it, and the build can't read the web manifest
val shareTarget =
  """{"action": "$serverUrl/share", "method": "POST", "enctype": "multipart/form-data",
  "params": {"title": "title", "text": "text", "url": "url",
  "files": [{"name": "files", "accept": ["*/*"]}]}}"""

val assetStatements =
  """[{"relation": ["delegate_permission/common.handle_all_urls"],
  "target": {"namespace": "web", "site": "$serverUrl"}}]"""

// A string resource drops bare quotes
fun escaped(json: String) = json.replace("\"", "\\\"")

android {
  namespace = "app.ajot"
  compileSdk = 36

  defaultConfig {
    applicationId = System.getenv("ANDROID_PACKAGE_NAME") ?: "app.ajot"
    minSdk = 24
    targetSdk = 36
    versionCode = (System.getenv("VERSION_CODE") ?: "1").toInt()
    versionName = System.getenv("VERSION_NAME") ?: "0.0.0-dev"

    manifestPlaceholders["host"] = URI(serverUrl).host
    resValue("string", "launchUrl", "$serverUrl/")
    resValue("string", "assetStatements", escaped(assetStatements))
    resValue("string", "shareTarget", escaped(shareTarget))
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
