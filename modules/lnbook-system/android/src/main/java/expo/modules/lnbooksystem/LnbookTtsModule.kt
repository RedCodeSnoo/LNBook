package expo.modules.lnbooksystem

import android.content.Intent
import android.speech.tts.TextToSpeech
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Voice of the app: Android speech engine, playback service and media controls. */
class LnbookTtsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LnbookTts")

    Events("onTtsState", "onTtsSentence", "onTtsFinished", "onTtsCommand", "onTtsSleep", "onTtsError")

    OnCreate {
      TtsPlayer.emit = { name, body -> sendEvent(name, body) }
    }

    OnDestroy {
      TtsPlayer.emit = null
    }

    AsyncFunction("getEngines") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(emptyList<Map<String, Any?>>())
      } else {
        TtsPlayer.runOnMain { TtsPlayer.engines(context) { promise.resolve(it) } }
      }
    }

    AsyncFunction("getVoices") { engine: String?, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(emptyList<Map<String, Any?>>())
      } else {
        TtsPlayer.runOnMain { TtsPlayer.voices(context, engine) { promise.resolve(it) } }
      }
    }

    Function("configure") { rate: Double, pitch: Double, pauseMs: Double, voice: String?, language: String? ->
      TtsPlayer.runOnMain { TtsPlayer.configure(rate.toFloat(), pitch.toFloat(), pauseMs.toLong(), voice, language) }
    }

    AsyncFunction("load") { options: Map<String, Any?>, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      val sentences = (options["sentences"] as? List<*>)?.map { it?.toString() ?: "" } ?: emptyList()
      val ends = (options["endsBlock"] as? List<*>)?.map { it == true } ?: emptyList()
      val labels = (options["labels"] as? Map<*, *>)
        ?.entries?.associate { it.key.toString() to (it.value?.toString() ?: "") } ?: emptyMap()
      TtsPlayer.runOnMain {
        TtsPlayer.load(
          context,
          options["engine"] as? String,
          sentences,
          ends,
          (options["start"] as? Number)?.toInt() ?: 0,
          options["autoplay"] != false,
          options["title"] as? String ?: "",
          options["subtitle"] as? String ?: "",
          options["coverPath"] as? String,
          options["hasNext"] == true,
          options["hasPrevious"] == true,
          labels,
        ) { promise.resolve(it) }
      }
    }

    Function("play") { TtsPlayer.runOnMain { TtsPlayer.play() } }
    Function("pause") { TtsPlayer.runOnMain { TtsPlayer.pause() } }
    Function("stop") { TtsPlayer.runOnMain { TtsPlayer.stop() } }
    Function("seekTo") { index: Int -> TtsPlayer.runOnMain { TtsPlayer.seekTo(index) } }
    Function("setSleepTimer") { ms: Double -> TtsPlayer.runOnMain { TtsPlayer.setSleepTimer(ms.toLong()) } }
    Function("getSleepRemaining") { TtsPlayer.sleepRemainingMs().toDouble() }
    Function("getState") { mapOf("state" to TtsPlayer.state, "index" to TtsPlayer.index) }

    Function("speakSample") { engine: String?, text: String, voice: String?, language: String?, rate: Double, pitch: Double ->
      val context = appContext.reactContext ?: return@Function
      TtsPlayer.runOnMain { TtsPlayer.sample(context, engine, text, voice, language, rate.toFloat(), pitch.toFloat()) }
    }

    // Android screens: speech settings, and installation of more voices.
    Function("openVoiceSettings") {
      val context = appContext.reactContext ?: return@Function false
      try {
        context.startActivity(Intent("com.android.settings.TTS_SETTINGS").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
      } catch (_: Exception) {
        false
      }
    }

    Function("installVoices") {
      val context = appContext.reactContext ?: return@Function false
      try {
        context.startActivity(
          Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        true
      } catch (_: Exception) {
        false
      }
    }
  }
}
