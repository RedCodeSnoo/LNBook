package expo.modules.lnbooksystem

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.os.Build
import android.os.IBinder

/**
 * Foreground service of the voice: keeps the app alive with the screen off and shows the
 * notification with the playback controls (also on the lock screen).
 */
class TtsService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    starting = false
    when (intent?.action) {
      ACTION_PLAY -> TtsPlayer.runOnMain { TtsPlayer.play() }
      ACTION_PAUSE -> TtsPlayer.runOnMain { TtsPlayer.pause() }
      ACTION_NEXT -> TtsPlayer.runOnMain { TtsPlayer.command("next") }
      ACTION_PREVIOUS -> TtsPlayer.runOnMain { TtsPlayer.command("previous") }
      ACTION_STOP -> TtsPlayer.runOnMain { TtsPlayer.stop() }
    }
    if (TtsPlayer.state == TtsPlayer.STOPPED) {
      // Nothing to read (e.g. the system restarted the service): close right away.
      startForegroundSafely()
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return START_NOT_STICKY
    }
    startForegroundSafely()
    return START_NOT_STICKY
  }

  private fun startForegroundSafely() {
    try {
      val notification = buildNotification(this)
      if (Build.VERSION.SDK_INT >= 29) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
      running = true
    } catch (_: Exception) {
      // The system refused the foreground service: reading continues while the app is open.
    }
  }

  override fun onDestroy() {
    running = false
    super.onDestroy()
  }

  // The app was swiped away from the recent apps: the voice stops with it.
  override fun onTaskRemoved(rootIntent: Intent?) {
    TtsPlayer.runOnMain { TtsPlayer.stop() }
    super.onTaskRemoved(rootIntent)
  }

  companion object {
    const val CHANNEL_ID = "voice"
    const val NOTIFICATION_ID = 4102
    const val ACTION_PLAY = "expo.modules.lnbooksystem.tts.PLAY"
    const val ACTION_PAUSE = "expo.modules.lnbooksystem.tts.PAUSE"
    const val ACTION_NEXT = "expo.modules.lnbooksystem.tts.NEXT"
    const val ACTION_PREVIOUS = "expo.modules.lnbooksystem.tts.PREVIOUS"
    const val ACTION_STOP = "expo.modules.lnbooksystem.tts.STOP"

    @Volatile
    var running = false

    /** True between the request to start the service and its first command. */
    @Volatile
    private var starting = false

    fun start(context: Context) {
      if (running || starting) {
        // Already there (next chapter): only the notification changes.
        refresh(context)
        return
      }
      try {
        ensureChannel(context)
        starting = true
        context.startForegroundService(Intent(context, TtsService::class.java))
      } catch (_: Exception) {
        // Started from the background without permission: no notification, voice still works.
        starting = false
      }
    }

    fun stop(context: Context) {
      // A service that was asked to start must first show its notification: it closes
      // itself in its first command when there is nothing left to read.
      if (starting) return
      context.stopService(Intent(context, TtsService::class.java))
    }

    fun refresh(context: Context) {
      if (!running) return
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.notify(NOTIFICATION_ID, buildNotification(context))
    }

    private fun ensureChannel(context: Context) {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val name = TtsPlayer.labels["channel"] ?: "Voice"
      val channel = NotificationChannel(CHANNEL_ID, name, NotificationManager.IMPORTANCE_LOW)
      channel.setShowBadge(false)
      channel.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      manager.createNotificationChannel(channel)
    }

    private fun action(context: Context, icon: Int, label: String, action: String, code: Int): Notification.Action {
      val intent = Intent(context, TtsService::class.java).setAction(action)
      val pending = PendingIntent.getService(
        context,
        code,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      return Notification.Action.Builder(Icon.createWithResource(context, icon), label, pending).build()
    }

    fun buildNotification(context: Context): Notification {
      val labels = TtsPlayer.labels
      val playing = TtsPlayer.state == TtsPlayer.PLAYING
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      val builder = Notification.Builder(context, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_lock_silent_mode_off)
        .setContentTitle(TtsPlayer.subtitle)
        .setContentText(TtsPlayer.title)
        .setOngoing(playing)
        .setOnlyAlertOnce(true)
        .setShowWhen(false)
        .setVisibility(Notification.VISIBILITY_PUBLIC)
        .setCategory(Notification.CATEGORY_TRANSPORT)
      TtsPlayer.cover?.let { builder.setLargeIcon(it) }
      if (launch != null) {
        builder.setContentIntent(
          PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE),
        )
      }
      builder.setDeleteIntent(
        PendingIntent.getService(
          context,
          9,
          Intent(context, TtsService::class.java).setAction(ACTION_STOP),
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        ),
      )

      val compact = mutableListOf<Int>()
      var count = 0
      if (TtsPlayer.hasPrevious) {
        builder.addAction(action(context, android.R.drawable.ic_media_previous, labels["previous"] ?: "Previous", ACTION_PREVIOUS, 1))
        count += 1
      }
      builder.addAction(
        if (playing) {
          action(context, android.R.drawable.ic_media_pause, labels["pause"] ?: "Pause", ACTION_PAUSE, 2)
        } else {
          action(context, android.R.drawable.ic_media_play, labels["play"] ?: "Play", ACTION_PLAY, 3)
        },
      )
      compact.add(count)
      count += 1
      if (TtsPlayer.hasNext) {
        builder.addAction(action(context, android.R.drawable.ic_media_next, labels["next"] ?: "Next", ACTION_NEXT, 4))
        compact.add(count)
        count += 1
      }
      builder.addAction(action(context, android.R.drawable.ic_menu_close_clear_cancel, labels["stop"] ?: "Stop", ACTION_STOP, 5))
      compact.add(count)

      val style = Notification.MediaStyle().setShowActionsInCompactView(*compact.take(3).toIntArray())
      TtsPlayer.sessionToken?.let { style.setMediaSession(it) }
      builder.setStyle(style)
      return builder.build()
    }
  }
}
