package app.ajot

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Bundle
import app.ajot.widget.ClaimWorker
import app.ajot.widget.RefreshWorker
import app.ajot.widget.TasksWidgetReceiver
import app.ajot.widget.WidgetData
import kotlinx.coroutines.runBlocking

/**
 * Opens the app in Chrome. It tells the page whether the widget is on the home screen, and while
 * that widget isn't signed in, hands the page a code to approve with its session
 * (client/src/lib/android-app.ts), so opening the app is all it takes.
 */
class LauncherActivity : com.google.androidbrowserhelper.trusted.LauncherActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // Changes made in the app push nothing back to this phone
    RefreshWorker.now(this)
  }

  override fun getLaunchingUrl(): Uri {
    val url = super.getLaunchingUrl()
    if (!widgetIsPlaced(this)) return url
    val launch = url.buildUpon().appendQueryParameter("ajot-widget", "placed")
    // A few bytes of app-private storage, read before Chrome is asked to open anything
    val code = runBlocking {
      if (WidgetData.isSignedIn(this@LauncherActivity)) null
      else WidgetData.signInCode(this@LauncherActivity)
    }
    if (code != null) {
      launch.appendQueryParameter("ajot-widget-code", code)
      ClaimWorker.start(this, code)
    }
    return launch.build()
  }
}

fun widgetIsPlaced(context: Context) =
  AppWidgetManager.getInstance(context)
    .getAppWidgetIds(ComponentName(context, TasksWidgetReceiver::class.java))
    .isNotEmpty()
