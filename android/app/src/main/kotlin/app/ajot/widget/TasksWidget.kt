package app.ajot.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.unit.dp
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
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import app.ajot.BuildConfig
import app.ajot.LauncherActivity

private val taskKey = ActionParameters.Key<String>("task")

class TasksWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = TasksWidget()

  override fun onEnabled(context: Context) {
    super.onEnabled(context)
    RefreshWorker.schedule(context)
  }

  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    super.onUpdate(context, manager, ids)
    RefreshWorker.now(context)
  }
}

class TasksWidget : GlanceAppWidget() {
  override suspend fun provideGlance(context: Context, id: GlanceId) {
    provideContent {
      val state by WidgetData.state(context).collectAsState(initial = WidgetState.Inbox(null))
      GlanceTheme { Content(context, state) }
    }
  }
}

@Composable
private fun Content(context: Context, state: WidgetState) {
  val text = TextStyle(color = GlanceTheme.colors.onSurface)
  val hint = TextStyle(color = GlanceTheme.colors.onSurfaceVariant)
  Column(
    modifier =
      GlanceModifier.fillMaxSize().background(GlanceTheme.colors.widgetBackground).padding(12.dp)
  ) {
    Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Text(
        "Inbox",
        style = text.copy(fontWeight = FontWeight.Bold),
        modifier = GlanceModifier.defaultWeight().clickable(openApp(context, "/")),
      )
      if (state is WidgetState.Inbox)
        Text(
          "Refresh",
          style = hint,
          modifier = GlanceModifier.padding(start = 8.dp).clickable(actionRunCallback<Refresh>()),
        )
    }
    Spacer(GlanceModifier.padding(top = 4.dp))
    when (state) {
      WidgetState.NotConnected ->
        Text(
          "Open Ajot's Settings and tap Connect the widget.",
          style = hint,
          modifier = GlanceModifier.clickable(openApp(context, "/settings")),
        )
      is WidgetState.Inbox ->
        when {
          state.tasks == null -> Text("Loading…", style = hint)
          state.tasks.isEmpty() -> Text("Nothing in your Inbox.", style = hint)
          else ->
            LazyColumn {
              items(state.tasks, itemId = { it.id.hashCode().toLong() }) { task ->
                CheckBox(
                  checked = false,
                  onCheckedChange = actionRunCallback<Tick>(actionParametersOf(taskKey to task.id)),
                  text = task.title,
                  style = text,
                  maxLines = 2,
                )
              }
            }
        }
    }
  }
}

/** Opens a route in the app, through the launcher that already handles the server's links. */
private fun openApp(context: Context, path: String) =
  actionStartActivity(
    Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.SERVER_URL + path))
      .setClass(context, LauncherActivity::class.java)
  )

class Tick : ActionCallback {
  override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
    val id = parameters[taskKey] ?: return
    WidgetData.markPending(context, id)
    TickWorker.send(context, id)
    TasksWidget().updateAll(context)
  }
}

class Refresh : ActionCallback {
  override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
    RefreshWorker.now(context)
  }
}
