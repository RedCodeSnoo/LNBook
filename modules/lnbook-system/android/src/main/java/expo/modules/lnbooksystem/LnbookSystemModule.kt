package expo.modules.lnbooksystem

import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class LnbookSystemModule : Module() {
  private fun copyToCache(context: Context, file: IncomingFile): String {
    val directory = File(context.cacheDir, "incoming")
    directory.mkdirs()
    val safeName = file.name.replace(Regex("[^A-Za-z0-9._-]"), "_").takeLast(80)
    val target = File(directory, "${System.nanoTime()}-$safeName")
    val input = context.contentResolver.openInputStream(Uri.parse(file.uri))
      ?: throw IllegalStateException("Cannot open ${file.uri}")
    input.use { source -> target.outputStream().use { source.copyTo(it) } }
    return Uri.fromFile(target).toString()
  }

  override fun definition() = ModuleDefinition {
    Name("LnbookSystem")

    Events("onVolumeKey", "onIncomingFiles", "onUpdateDownloadProgress")

    OnCreate {
      SystemState.onVolumeKey = { direction -> sendEvent("onVolumeKey", mapOf("direction" to direction)) }
      SystemState.onIncomingFiles = { sendEvent("onIncomingFiles", emptyMap<String, Any>()) }
    }

    OnDestroy {
      SystemState.onVolumeKey = null
      SystemState.onIncomingFiles = null
      SystemState.volumeKeysEnabled = false
    }

    Function("setVolumeKeysEnabled") { enabled: Boolean ->
      SystemState.volumeKeysEnabled = enabled
    }

    // Foreground service of the download queue (progress notification, screen off).
    Function("startDownloadService") { channelName: String, title: String, text: String ->
      val context = appContext.reactContext ?: return@Function false
      try {
        DownloadService.ensureChannel(context, channelName)
        val intent = Intent(context, DownloadService::class.java)
          .putExtra(DownloadService.EXTRA_TITLE, title)
          .putExtra(DownloadService.EXTRA_TEXT, text)
        context.startForegroundService(intent)
        true
      } catch (error: Exception) {
        false
      }
    }

    Function("updateDownloadService") { title: String, text: String, progress: Int, max: Int ->
      appContext.reactContext?.let { DownloadService.update(it, title, text, progress, max) }
      Unit
    }

    Function("stopDownloadService") {
      appContext.reactContext?.let { it.stopService(Intent(it, DownloadService::class.java)) }
      Unit
    }

    Function("isMusicActive") {
      val audio = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      audio?.isMusicActive == true
    }

    // Timer that keeps working while the app is in the background (screen off): the
    // JavaScript timers are suspended there, native callbacks are not.
    AsyncFunction("delay") { ms: Double, promise: Promise ->
      Handler(Looper.getMainLooper()).postDelayed({ promise.resolve(null) }, ms.toLong().coerceAtLeast(0))
    }

    // App update: download with progress and checksum, then the Android installer.
    AsyncFunction("downloadUpdate") { url: String, name: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("No context")
      AppUpdate.download(context, url, name) { received, total ->
        sendEvent("onUpdateDownloadProgress", mapOf("received" to received.toDouble(), "total" to total.toDouble()))
      }
    }

    Function("canInstallUpdates") {
      appContext.reactContext?.let { AppUpdate.canInstall(it) } ?: false
    }

    Function("openInstallSettings") {
      appContext.reactContext?.let { AppUpdate.openInstallSettings(it) }
      Unit
    }

    Function("installUpdate") { path: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("No context")
      AppUpdate.install(context, path)
    }

    // Runs off the JavaScript thread: each file is copied into the cache of the app while
    // the permission given with the intent is still valid.
    AsyncFunction("takeIncomingFiles") {
      val context = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, String?>>()
      SystemState.takeFiles().map { file ->
        try {
          mapOf("uri" to copyToCache(context, file), "name" to file.name, "error" to null)
        } catch (error: Exception) {
          mapOf("uri" to null, "name" to file.name, "error" to (error.message ?: error.javaClass.simpleName))
        }
      }
    }
  }
}
