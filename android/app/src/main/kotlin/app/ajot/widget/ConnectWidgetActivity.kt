package app.ajot.widget

import android.app.Activity
import android.os.Bundle
import android.widget.Toast
import androidx.glance.appwidget.updateAll
import kotlinx.coroutines.runBlocking

/**
 * Keeps the token Settings hands over (`client/src/lib/android-app.ts`), then closes, back to the
 * app. Any page could open this, but it can only connect the widget to the token it sends.
 */
class ConnectWidgetActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val token = intent.getStringExtra("token")
    if (token != null && token.startsWith("ajot_wgt_")) {
      // A few bytes to app-private storage, before the activity closes
      runBlocking {
        WidgetData.connect(this@ConnectWidgetActivity, token)
        TasksWidget().updateAll(this@ConnectWidgetActivity)
      }
      RefreshWorker.schedule(this)
      RefreshWorker.now(this)
      Toast.makeText(this, "The widget is connected", Toast.LENGTH_SHORT).show()
    }
    finish()
  }
}
