package expo.modules.lnbooksystem

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Foreground service shown while the download queue runs. It does no work itself: its
 * only role is to keep the app process alive (screen off, app in the background) while
 * JavaScript downloads the chapters, and to show the progress.
 */
class DownloadService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: ""
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: ""
    val notification = buildNotification(this, title, text, 0, 0)
    try {
      if (Build.VERSION.SDK_INT >= 29) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
      running = true
    } catch (error: Exception) {
      // The system refused the foreground service (e.g. started from the background):
      // downloads still run while the app is open.
      stopSelf()
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    running = false
    super.onDestroy()
  }

  // Android 15 stops data sync services after a daily time limit.
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopSelf()
  }

  companion object {
    const val CHANNEL_ID = "downloads"
    const val NOTIFICATION_ID = 4101
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"

    @Volatile
    var running = false

    fun ensureChannel(context: Context, name: String) {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val channel = NotificationChannel(CHANNEL_ID, name, NotificationManager.IMPORTANCE_LOW)
      channel.setShowBadge(false)
      manager.createNotificationChannel(channel)
    }

    fun buildNotification(context: Context, title: String, text: String, progress: Int, max: Int): Notification {
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      val pending = launch?.let {
        PendingIntent.getActivity(
          context,
          0,
          it,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
      }
      val builder = Notification.Builder(context, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.stat_sys_download)
        .setContentTitle(title)
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setCategory(Notification.CATEGORY_PROGRESS)
      if (max > 0) {
        builder.setProgress(max, progress.coerceIn(0, max), false)
      } else {
        builder.setProgress(0, 0, true)
      }
      if (pending != null) {
        builder.setContentIntent(pending)
      }
      return builder.build()
    }

    fun update(context: Context, title: String, text: String, progress: Int, max: Int) {
      if (!running) return
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.notify(NOTIFICATION_ID, buildNotification(context, title, text, progress, max))
    }
  }
}
