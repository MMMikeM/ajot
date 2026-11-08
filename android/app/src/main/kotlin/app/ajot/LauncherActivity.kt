package app.ajot

import android.os.Bundle
import app.ajot.widget.RefreshWorker

/** Opens the app in Chrome, and refreshes the widget, since changes made here push nothing back. */
class LauncherActivity : com.google.androidbrowserhelper.trusted.LauncherActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    RefreshWorker.now(this)
  }
}
