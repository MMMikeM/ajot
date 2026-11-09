package app.ajot.widget

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.os.Build
import android.os.Bundle
import android.widget.Toast

/**
 * Settings' "Add Inbox to home screen" (client/src/lib/android-app.ts): Android's own dialog places
 * the widget, which signs in on its first tap. It takes no code: any page or app can open this, and
 * a code it handed over would choose whose Inbox the widget shows.
 */
class AddWidgetActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val manager = AppWidgetManager.getInstance(this)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.isRequestPinAppWidgetSupported)
      manager.requestPinAppWidget(ComponentName(this, TasksWidgetReceiver::class.java), null, null)
    else
      Toast.makeText(this, "Add Ajot from your home screen's widgets", Toast.LENGTH_LONG).show()
    finish()
  }
}
