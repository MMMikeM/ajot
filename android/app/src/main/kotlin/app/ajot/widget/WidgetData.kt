package app.ajot.widget

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import android.util.Base64
import java.security.SecureRandom
import org.json.JSONArray
import org.json.JSONObject

data class WidgetTask(val id: String, val title: String)

sealed interface WidgetState {
  data object SignedOut : WidgetState

  data class Inbox(val tasks: List<WidgetTask>?) : WidgetState
}

// App-private, and left out of backups and device transfer (res/xml/data_extraction_rules.xml),
// so the token stays on this phone
private val Context.widgetStore by preferencesDataStore("widget")
private val TOKEN = stringPreferencesKey("token")
private val TASKS = stringPreferencesKey("tasks")
// Ticked here but not yet sent: hidden from every list until the server has them
private val PENDING = stringSetPreferencesKey("pending")
// The code the app's page approves to sign the widget in (server/src/widget-codes.ts)
private val CODE = stringPreferencesKey("code")

/** The widget's token and the last Inbox it fetched, so it shows offline. */
object WidgetData {
  suspend fun token(context: Context): String? = context.widgetStore.data.first()[TOKEN]

  /** The same code until the widget is signed in, however often the app opens meanwhile. */
  suspend fun signInCode(context: Context): String {
    var code = ""
    context.widgetStore.edit {
      code = it[CODE] ?: newCode().also { fresh -> it[CODE] = fresh }
    }
    return code
  }

  private fun newCode(): String {
    val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
    return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
  }

  suspend fun isSignedIn(context: Context) = token(context) != null

  // Ticks still waiting to be sent outlive a sign-out: they go once the widget signs in again
  suspend fun connect(context: Context, token: String) {
    context.widgetStore.edit {
      it.remove(TASKS)
      it.remove(CODE)
      it[TOKEN] = token
    }
  }

  suspend fun disconnect(context: Context) {
    context.widgetStore.edit {
      it.remove(TOKEN)
      it.remove(TASKS)
    }
  }

  fun state(context: Context): Flow<WidgetState> =
    context.widgetStore.data.map { prefs ->
      if (prefs[TOKEN] == null) return@map WidgetState.SignedOut
      val pending = prefs[PENDING].orEmpty()
      WidgetState.Inbox(prefs[TASKS]?.let(::parse)?.filterNot { it.id in pending })
    }

  suspend fun saveInbox(context: Context, tasks: List<WidgetTask>) {
    context.widgetStore.edit { it[TASKS] = serialize(tasks) }
  }

  suspend fun markPending(context: Context, id: String) {
    context.widgetStore.edit { it[PENDING] = it[PENDING].orEmpty() + id }
  }

  /** Sent: out of the saved Inbox too, so a fetch made before the server had it can't bring it back. */
  suspend fun clearPending(context: Context, id: String) {
    context.widgetStore.edit {
      it[PENDING] = it[PENDING].orEmpty() - id
      it[TASKS]?.let { json -> it[TASKS] = serialize(parse(json).filterNot { task -> task.id == id }) }
    }
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
