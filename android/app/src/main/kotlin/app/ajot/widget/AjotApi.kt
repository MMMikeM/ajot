package app.ajot.widget

import app.ajot.BuildConfig
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** The two routes the widget's token may call (server/src/mcp/caller.ts). */
object AjotApi {
  /** The token was revoked or has expired: the widget has to be connected again. */
  class SignedOut : Exception()

  suspend fun inbox(token: String): List<WidgetTask> =
    withContext(Dispatchers.IO) {
      val tasks = JSONArray(request("GET", "/api/tasks/inbox", token, body = null))
      (0 until tasks.length()).map {
        val task = tasks.getJSONObject(it)
        WidgetTask(task.getString("id"), task.getString("title"))
      }
    }

  /** Done, or refused for good (gone, no longer shared): either way, nothing left to send. */
  suspend fun markDone(token: String, id: String, stamp: String) {
    withContext(Dispatchers.IO) {
      val body =
        JSONObject()
          .put("ids", JSONArray(listOf(id)))
          .put("status", "done")
          .put("updatedAt", stamp)
      request("PUT", "/api/tasks/status", token, body.toString())
    }
  }

  // The server's ISO format; java.time needs API 26
  fun now(): String =
    SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT)
      .apply { timeZone = TimeZone.getTimeZone("UTC") }
      .format(Date())

  private fun request(method: String, path: String, token: String, body: String?): String {
    val connection = URL(BuildConfig.SERVER_URL + path).openConnection() as HttpURLConnection
    try {
      connection.requestMethod = method
      connection.connectTimeout = 15_000
      connection.readTimeout = 15_000
      connection.setRequestProperty("Authorization", "Bearer $token")
      if (body != null) {
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json")
        connection.outputStream.use { it.write(body.toByteArray()) }
      }
      val status = connection.responseCode
      if (status == 401) throw SignedOut()
      if (status >= 500 || status == 429) throw IOException("$method $path answered $status")
      return (if (status < 400) connection.inputStream else connection.errorStream)
        ?.bufferedReader()
        ?.use { it.readText() }
        .orEmpty()
    } finally {
      connection.disconnect()
    }
  }
}
