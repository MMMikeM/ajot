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

/** The routes the widget calls: its sign-in, then the two its token may (server/src/mcp/caller.ts). */
object AjotApi {
  /** Signed out in the app, or its token expired: the widget signs in again on its next tap. */
  class SignedOut : Exception()

  suspend fun inbox(token: String): List<WidgetTask> =
    withContext(Dispatchers.IO) {
      val tasks = JSONArray(request("GET", "/api/tasks/inbox", token, body = null))
      (0 until tasks.length()).map {
        val task = tasks.getJSONObject(it)
        WidgetTask(task.getString("id"), task.getString("title"))
      }
    }

  /** The widget's own token once the app has approved `code`, or null while it hasn't yet. */
  suspend fun claim(code: String): String? =
    withContext(Dispatchers.IO) {
      val body = JSONObject().put("code", code).toString()
      val (status, reply) = send("POST", "/api/widget/claim", token = null, body)
      when {
        status == 200 -> JSONObject(reply).getString("token")
        status == 404 -> null
        else -> throw IOException("claiming answered $status")
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
    val (status, reply) = send(method, path, token, body)
    if (status == 401) throw SignedOut()
    if (status >= 500 || status == 429) throw IOException("$method $path answered $status")
    return reply
  }

  private fun send(method: String, path: String, token: String?, body: String?): Pair<Int, String> {
    val connection = URL(BuildConfig.SERVER_URL + path).openConnection() as HttpURLConnection
    try {
      connection.requestMethod = method
      connection.connectTimeout = 15_000
      connection.readTimeout = 15_000
      if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
      if (body != null) {
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json")
        connection.outputStream.use { it.write(body.toByteArray()) }
      }
      val status = connection.responseCode
      val reply =
        (if (status < 400) connection.inputStream else connection.errorStream)
          ?.bufferedReader()
          ?.use { it.readText() }
          .orEmpty()
      return status to reply
    } finally {
      connection.disconnect()
    }
  }
}
