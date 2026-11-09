package app.ajot.widget

import android.content.Context
import androidx.glance.appwidget.updateAll
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.io.IOException
import java.util.concurrent.TimeUnit
import android.os.SystemClock
import kotlinx.coroutines.delay
import org.json.JSONException

private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

/** Fetches the Inbox into the widget's copy. */
class RefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    val token = WidgetData.token(applicationContext) ?: return Result.success()
    return try {
      WidgetData.saveInbox(applicationContext, AjotApi.inbox(token))
      Result.success()
    } catch (_: AjotApi.SignedOut) {
      WidgetData.disconnect(applicationContext)
      Result.success()
    } catch (_: IOException) {
      Result.retry()
    } catch (_: JSONException) {
      // Not the Inbox (a proxy's page, a refusal): keep the saved one until the next run
      Result.success()
    } finally {
      TasksWidget().updateAll(applicationContext)
    }
  }

  companion object {
    fun now(context: Context) {
      WorkManager.getInstance(context)
        .enqueueUniqueWork(
          "refresh",
          ExistingWorkPolicy.REPLACE,
          OneTimeWorkRequestBuilder<RefreshWorker>().setConstraints(online).build(),
        )
    }

    fun stop(context: Context) {
      WorkManager.getInstance(context).cancelUniqueWork("refresh-every-15-minutes")
    }

    // Android's shortest period; pushes and opening the app refresh it sooner
    fun schedule(context: Context) {
      WorkManager.getInstance(context)
        .enqueueUniquePeriodicWork(
          "refresh-every-15-minutes",
          ExistingPeriodicWorkPolicy.KEEP,
          PeriodicWorkRequestBuilder<RefreshWorker>(15, TimeUnit.MINUTES)
            .setConstraints(online)
            .build(),
        )
    }
  }
}

/** Sends a tick made on the widget, offline included: it waits for a connection. */
class TickWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    val id = inputData.getString(ID) ?: return Result.success()
    val stamp = inputData.getString(STAMP) ?: return Result.success()
    // Signed out, the tick waits for the widget to sign in again rather than being dropped
    val token = WidgetData.token(applicationContext) ?: return Result.retry()
    return try {
      AjotApi.markDone(token, id, stamp)
      WidgetData.clearPending(applicationContext, id)
      RefreshWorker.now(applicationContext)
      Result.success()
    } catch (_: AjotApi.SignedOut) {
      WidgetData.disconnect(applicationContext)
      TasksWidget().updateAll(applicationContext)
      Result.retry()
    } catch (_: IOException) {
      Result.retry()
    }
  }

  companion object {
    private const val ID = "id"
    private const val STAMP = "stamp"

    // Stamped when ticked, not when sent, so a later edit elsewhere wins over a late send
    fun send(context: Context, id: String) {
      WorkManager.getInstance(context)
        .enqueueUniqueWork(
          "tick-$id",
          ExistingWorkPolicy.KEEP,
          OneTimeWorkRequestBuilder<TickWorker>()
            .setConstraints(online)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .setInputData(workDataOf(ID to id, STAMP to AjotApi.now()))
            .build(),
        )
    }
  }
}

/** Waits for the app's page to approve the widget's code, then keeps the token it claims. */
class ClaimWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    val code = inputData.getString(CODE) ?: return Result.success()
    // Inside WorkManager's ten minutes; the server's approval lasts as long
    val until = SystemClock.elapsedRealtime() + BUDGET_MS
    while (SystemClock.elapsedRealtime() < until) {
      val token =
        try {
          AjotApi.claim(code)
        } catch (_: IOException) {
          null
        }
      if (token != null) {
        WidgetData.connect(applicationContext, token)
        TasksWidget().updateAll(applicationContext)
        RefreshWorker.schedule(applicationContext)
        RefreshWorker.now(applicationContext)
        return Result.success()
      }
      delay(EVERY_MS)
    }
    return Result.success()
  }

  companion object {
    private const val CODE = "code"
    private const val BUDGET_MS = 9 * 60_000L
    private const val EVERY_MS = 4_000L

    fun start(context: Context, code: String) {
      // The same code until it's claimed, so a launch never cancels a claim the server has answered
      WorkManager.getInstance(context)
        .enqueueUniqueWork(
          "claim",
          ExistingWorkPolicy.KEEP,
          OneTimeWorkRequestBuilder<ClaimWorker>()
            .setConstraints(online)
            .setInputData(workDataOf(CODE to code))
            .build(),
        )
    }
  }
}
