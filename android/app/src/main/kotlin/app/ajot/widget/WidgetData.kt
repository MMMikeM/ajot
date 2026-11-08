package app.ajot.widget

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import org.json.JSONArray
import org.json.JSONObject

data class WidgetTask(val id: String, val title: String)

sealed interface WidgetState {
  data object NotConnected : WidgetState

  data class Inbox(val tasks: List<WidgetTask>?) : WidgetState
}

// App-private and left out of backups (allowBackup="false"), so the token stays on this phone
private val Context.widgetStore by preferencesDataStore("widget")
private val TOKEN = stringPreferencesKey("token")
private val TASKS = stringPreferencesKey("tasks")
// Ticked here but not yet sent: hidden from every list until the server has them
private val PENDING = stringSetPreferencesKey("pending")

/** The widget's token and the last Inbox it fetched, so it shows offline. */
object WidgetData {
  suspend fun token(context: Context): String? = context.widgetStore.data.first()[TOKEN]

  suspend fun connect(context: Context, token: String) {
    context.widgetStore.edit {
      it.clear()
      it[TOKEN] = token
    }
  }

  suspend fun disconnect(context: Context) {
    context.widgetStore.edit { it.clear() }
  }

  fun state(context: Context): Flow<WidgetState> =
    context.widgetStore.data.map { prefs ->
      if (prefs[TOKEN] == null) return@map WidgetState.NotConnected
      val pending = prefs[PENDING].orEmpty()
      WidgetState.Inbox(prefs[TASKS]?.let(::parse)?.filterNot { it.id in pending })
    }

  suspend fun saveInbox(context: Context, tasks: List<WidgetTask>) {
    context.widgetStore.edit { it[TASKS] = serialize(tasks) }
  }

  suspend fun markPending(context: Context, id: String) {
    context.widgetStore.edit { it[PENDING] = it[PENDING].orEmpty() + id }
  }

  suspend fun clearPending(context: Context, id: String) {
    context.widgetStore.edit { it[PENDING] = it[PENDING].orEmpty() - id }
  }

  private fun parse(json: String): List<WidgetTask> {
    val array = JSONArray(json)
    return (0 until array.length()).map {
      val task = array.getJSONObject(it)
      WidgetTask(task.getString("id"), task.getString("title"))
    }
  }

  private fun serialize(tasks: List<WidgetTask>) =
    JSONArray(tasks.map { JSONObject().put("id", it.id).put("title", it.title) }).toString()
}
