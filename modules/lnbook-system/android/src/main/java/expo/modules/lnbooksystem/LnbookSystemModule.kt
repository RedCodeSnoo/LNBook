package expo.modules.lnbooksystem

import android.content.Context
import android.media.AudioManager
import android.net.Uri
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

    Events("onVolumeKey", "onIncomingFiles")

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

    Function("isMusicActive") {
      val audio = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      audio?.isMusicActive == true
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
