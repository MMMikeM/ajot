package app.ajot.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.ColorFilter
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.clickable
import androidx.glance.appwidget.CheckBox
import androidx.glance.appwidget.CheckboxDefaults
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ColumnScope
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import app.ajot.BuildConfig
import app.ajot.LauncherActivity
import app.ajot.R

private val taskKey = ActionParameters.Key<String>("task")

/**
 * DESIGN.md's ink, in the hex a widget takes. The sheet is `#151A22` at 72%, so the wallpaper shows
 * through while paper-white text keeps 6:1 even over a white one; the muted tone, for the refresh
 * icon and an open checkbox, keeps the 3:1 a control needs there. No text is set in it.
 */
private object Ink {
  val sheet = Color(0xB8151A22)
  val foreground = ColorProvider(Color(0xFFF1EEE6))
  val muted = ColorProvider(Color(0xFFA6AFBB))
  val primary = ColorProvider(Color(0xFF589A28))
  val inbox = Color(0xFFE1DDD8)
}

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
      Content(context, state)
    }
  }
}

@Composable
private fun Content(context: Context, state: WidgetState) {
  val sheet =
    GlanceModifier.fillMaxSize()
      .appWidgetBackground()
      .background(Ink.sheet)
      .cornerRadius(android.R.dimen.system_app_widget_background_radius)
      .padding(start = 16.dp, top = 12.dp, end = 8.dp, bottom = 8.dp)
  // Signed out, the whole widget is the way back in
  Column(
    modifier =
      if (state is WidgetState.SignedOut) sheet.clickable(openApp(context, "/")) else sheet
  ) {
    Header(context, state)
    Spacer(GlanceModifier.height(6.dp))
    when (state) {
      WidgetState.SignedOut -> Note("Tap to show your Inbox")
      is WidgetState.Inbox ->
        when {
          state.tasks == null -> Note("Loading…")
          state.tasks.isEmpty() -> Note("Nothing in your Inbox.")
          else -> Tasks(context, state.tasks)
        }
    }
  }
}

/** The app's list title, small: the Inbox's dot, its name and its open count. */
@Composable
private fun Header(context: Context, state: WidgetState) {
  val count = (state as? WidgetState.Inbox)?.tasks?.size
  Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
    Row(
      modifier = GlanceModifier.defaultWeight().clickable(openApp(context, "/")),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Box(modifier = GlanceModifier.size(7.dp).background(Ink.inbox).cornerRadius(4.dp)) {}
      Spacer(GlanceModifier.width(8.dp))
      Text(
        "Inbox",
        style = TextStyle(color = Ink.foreground, fontSize = 16.sp, fontWeight = FontWeight.Medium),
      )
      if (count != null && count > 0) {
        Spacer(GlanceModifier.width(8.dp))
        Text("$count", style = TextStyle(color = Ink.foreground, fontSize = 13.sp))
      }
    }
    if (state is WidgetState.Inbox)
      Image(
        provider = ImageProvider(R.drawable.ic_refresh),
        contentDescription = "Refresh",
        colorFilter = ColorFilter.tint(Ink.muted),
        // A 48dp target around an 18dp glyph
        modifier = GlanceModifier.size(48.dp).padding(15.dp).clickable(actionRunCallback<Refresh>()),
      )
  }
}

@Composable
private fun Note(text: String) {
  Text(
    text,
    style = TextStyle(color = Ink.foreground, fontSize = 14.sp),
    modifier = GlanceModifier.padding(top = 4.dp, end = 8.dp),
  )
}

@Composable
private fun ColumnScope.Tasks(context: Context, tasks: List<WidgetTask>) {
  val box = CheckboxDefaults.colors(checkedColor = Ink.primary, uncheckedColor = Ink.muted)
  // A widget's list has no height of its own: without the rest of the column, it shows nothing
  LazyColumn(modifier = GlanceModifier.defaultWeight()) {
    items(tasks, itemId = { it.id.hashCode().toLong() }) { task ->
      // The box ticks; the title opens the task, as a row does in the app
      Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        CheckBox(
          checked = false,
          onCheckedChange = actionRunCallback<Tick>(actionParametersOf(taskKey to task.id)),
          colors = box,
        )
        Text(
          task.title,
          style = TextStyle(color = Ink.foreground, fontSize = 15.sp, fontWeight = FontWeight.Medium),
          maxLines = 2,
          modifier =
            GlanceModifier.defaultWeight()
              .padding(top = 10.dp, bottom = 10.dp, end = 8.dp)
              .clickable(openApp(context, "/task/${task.id}")),
        )
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
