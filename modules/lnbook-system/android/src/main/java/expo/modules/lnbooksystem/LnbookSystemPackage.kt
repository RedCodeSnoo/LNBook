package expo.modules.lnbooksystem

import android.app.Activity
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.KeyEvent
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityHandler
import expo.modules.core.interfaces.ReactActivityLifecycleListener

class LnbookSystemPackage : Package {
  override fun createReactActivityLifecycleListeners(activityContext: Context?): List<ReactActivityLifecycleListener> {
    return listOf(IncomingFilesListener())
  }

  override fun createReactActivityHandlers(activityContext: Context?): List<ReactActivityHandler> {
    // Called while the activity is being constructed: its context is not usable yet, so it
    // is only kept here and read when a key is pressed.
    return if (activityContext == null) emptyList() else listOf(VolumeKeysHandler(activityContext))
  }
}

/**
 * Turns pages with the volume buttons while the reader asked for it. The buttons keep
 * their normal role whenever sound is playing (music, video, or the voice of the app).
 */
internal class VolumeKeysHandler(private val context: Context) : ReactActivityHandler {
  private fun shouldHandle(keyCode: Int): Boolean {
    if (!SystemState.volumeKeysEnabled) return false
    if (keyCode != KeyEvent.KEYCODE_VOLUME_UP && keyCode != KeyEvent.KEYCODE_VOLUME_DOWN) return false
    val audio = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
    return audio?.isMusicActive != true
  }

  override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
    if (!shouldHandle(keyCode)) return false
    if (event == null || event.repeatCount == 0) {
      SystemState.onVolumeKey?.invoke(if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) "up" else "down")
    }
    return true
  }

  override fun onKeyUp(keyCode: Int, event: KeyEvent?): Boolean = shouldHandle(keyCode)
}

/** Collects the files given by "Open with" and "Share to" intents. */
internal class IncomingFilesListener : ReactActivityLifecycleListener {
  override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
    // After a rotation the same intent is delivered again: only read it once.
    if (savedInstanceState == null) {
      handle(activity, activity.intent)
    }
  }

  override fun onNewIntent(intent: Intent?): Boolean {
    val activity = currentActivity ?: return false
    return handle(activity, intent)
  }

  override fun onResume(activity: Activity) {
    currentActivity = activity
  }

  override fun onDestroy(activity: Activity) {
    if (currentActivity === activity) currentActivity = null
  }

  private var currentActivity: Activity? = null

  private fun handle(activity: Activity, intent: Intent?): Boolean {
    currentActivity = activity
    if (intent == null) return false
    val uris: List<Uri> = when (intent.action) {
      Intent.ACTION_VIEW -> listOfNotNull(intent.data).filter { it.scheme == "content" || it.scheme == "file" }
      Intent.ACTION_SEND -> listOfNotNull(streamOf(intent))
      Intent.ACTION_SEND_MULTIPLE -> streamsOf(intent)
      else -> emptyList()
    }
    if (uris.isEmpty()) return false
    val resolver = activity.contentResolver
    SystemState.addFiles(uris.map { IncomingFile(it.toString(), displayName(resolver, it)) })
    return true
  }

  @Suppress("DEPRECATION")
  private fun streamOf(intent: Intent): Uri? =
    if (Build.VERSION.SDK_INT >= 33) {
      intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
    } else {
      intent.getParcelableExtra(Intent.EXTRA_STREAM)
    }

  @Suppress("DEPRECATION")
  private fun streamsOf(intent: Intent): List<Uri> =
    (if (Build.VERSION.SDK_INT >= 33) {
      intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
    } else {
      intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
    }) ?: emptyList()

  private fun displayName(resolver: ContentResolver, uri: Uri): String {
    if (uri.scheme == "content") {
      try {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
          if (cursor.moveToFirst()) {
            val name = cursor.getString(0)
            if (!name.isNullOrBlank()) return name
          }
        }
      } catch (_: Exception) {
        // Some providers refuse the query: fall back to the last path segment.
      }
    }
    return uri.lastPathSegment ?: "file"
  }
}
