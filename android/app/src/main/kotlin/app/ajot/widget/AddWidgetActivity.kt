package app.ajot.widget

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import kotlinx.coroutines.runBlocking

/**
 * Settings' "Add Inbox to home screen" (client/src/lib/android-app.ts): Android's own dialog
 * places the widget, which signs in with the code the page has already approved.
 */
class AddWidgetActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val code = intent.getStringExtra("code")
    if (code != null) {
      // A few bytes of app-private storage, before the activity closes
      runBlocking { WidgetData.useCode(this@AddWidgetActivity, code) }
      ClaimWorker.start(this, code)
    }
    val manager = AppWidgetManager.getInstance(this)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.isRequestPinAppWidgetSupported)
      manager.requestPinAppWidget(ComponentName(this, TasksWidgetReceiver::class.java), null, null)
    else
      Toast.makeText(this, "Add Ajot from your home screen's widgets", Toast.LENGTH_LONG).show()
    finish()
  }
}
