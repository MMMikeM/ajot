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
    val token = WidgetData.token(applicationContext)
    return try {
      if (token != null) AjotApi.markDone(token, id, stamp)
      WidgetData.clearPending(applicationContext, id)
      RefreshWorker.now(applicationContext)
      Result.success()
    } catch (_: AjotApi.SignedOut) {
      WidgetData.disconnect(applicationContext)
      TasksWidget().updateAll(applicationContext)
      Result.success()
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
