package app.ajot.widget

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.clickable
import androidx.glance.appwidget.CheckBox
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.ToggleableStateKey
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.background
import androidx.glance.currentState
import androidx.glance.layout.Column
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import app.ajot.BuildConfig

private val TASKS = listOf("a" to "Check the checkbox persists", "b" to "Survives a reboot")
private val taskKey = ActionParameters.Key<String>("task")

class TasksWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = TasksWidget()
}

class TasksWidget : GlanceAppWidget() {
  override suspend fun provideGlance(context: Context, id: GlanceId) {
    provideContent { GlanceTheme { Content(context) } }
  }
}

@Composable
private fun Content(context: Context) {
  val state = currentState<Preferences>()
  val text = TextStyle(color = GlanceTheme.colors.onSurface)
  Column(
    modifier =
      GlanceModifier.fillMaxSize().background(GlanceTheme.colors.widgetBackground).padding(12.dp)
  ) {
    Text("Ajot POC", style = text.copy(fontWeight = FontWeight.Bold))
    TASKS.forEach { (id, title) ->
      CheckBox(
        checked = state[booleanPreferencesKey(id)] ?: false,
        onCheckedChange = actionRunCallback<ToggleTask>(actionParametersOf(taskKey to id)),
        text = title,
        style = text,
      )
    }
    RouteLink(context, "Open Settings", "/settings", text)
    RouteLink(context, "Open Search", "/search", text)
  }
}

/** Opens a route in the TWA, through the launcher that already handles the server's links. */
@Composable
private fun RouteLink(context: Context, label: String, path: String, style: TextStyle) {
  val intent =
    Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.SERVER_URL + path))
      .setClassName(context, "com.google.androidbrowserhelper.trusted.LauncherActivity")
  Text(
    label,
    style = style.copy(color = GlanceTheme.colors.primary),
    modifier = GlanceModifier.padding(top = 8.dp).clickable(actionStartActivity(intent)),
  )
}

class ToggleTask : ActionCallback {
  override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
    val id = parameters[taskKey] ?: return
    val checked = parameters[ToggleableStateKey] ?: return
    updateAppWidgetState(context, glanceId) { it[booleanPreferencesKey(id)] = checked }
    TasksWidget().update(context, glanceId)
  }
}
