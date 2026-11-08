buildscript {
  repositories {
    google()
    mavenCentral()
  }
  dependencies {
    classpath("com.android.tools.build:gradle:9.5.1")
    // AGP's built-in Kotlin runs the newest KGP on the classpath, and the Compose compiler plugin
    // must be that same version
    classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.21")
    classpath("org.jetbrains.kotlin:compose-compiler-gradle-plugin:2.4.21")
  }
}
