package app.ajot

import android.app.Notification
import app.ajot.widget.RefreshWorker

/**
 * Shows the site's notifications as the app's. Each one means something changed elsewhere, and
 * it's the only push native code sees, so the widget refreshes on it.
 */
class DelegationService : com.google.androidbrowserhelper.trusted.DelegationService() {
  override fun onNotifyNotificationWithChannel(
    platformTag: String,
    platformId: Int,
    notification: Notification,
    channelName: String,
  ): Boolean {
    RefreshWorker.now(this)
    return super.onNotifyNotificationWithChannel(platformTag, platformId, notification, channelName)
  }
}
