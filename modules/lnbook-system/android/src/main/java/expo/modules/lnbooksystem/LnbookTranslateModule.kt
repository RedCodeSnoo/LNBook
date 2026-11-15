package expo.modules.lnbooksystem

import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.TranslateRemoteModel
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * On-device translation (Google ML Kit). Models are downloaded once per language
 * (about 30 MB each); translating then works without any network.
 */
class LnbookTranslateModule : Module() {
  private val translators = mutableMapOf<String, Translator>()

  private fun translator(source: String, target: String): Translator? {
    val from = TranslateLanguage.fromLanguageTag(source) ?: return null
    val to = TranslateLanguage.fromLanguageTag(target) ?: return null
    return synchronized(translators) {
      translators.getOrPut("$from>$to") {
        Translation.getClient(
          TranslatorOptions.Builder().setSourceLanguage(from).setTargetLanguage(to).build(),
        )
      }
    }
  }

  /** Translates the texts one after the other, keeping their order. */
  private fun translateAll(engine: Translator, texts: List<String>, index: Int, out: MutableList<String>, promise: Promise) {
    if (index >= texts.size) {
      promise.resolve(out)
      return
    }
    val text = texts[index]
    if (text.isBlank()) {
      out.add(text)
      translateAll(engine, texts, index + 1, out, promise)
      return
    }
    engine.translate(text)
      .addOnSuccessListener { translated ->
        out.add(translated)
        translateAll(engine, texts, index + 1, out, promise)
      }
      .addOnFailureListener { error ->
        promise.reject("ERR_TRANSLATE", error.message ?: "Translation failed", error)
      }
  }

  override fun definition() = ModuleDefinition {
    Name("LnbookTranslate")

    OnDestroy {
      synchronized(translators) {
        translators.values.forEach { it.close() }
        translators.clear()
      }
    }

    /** Language codes ML Kit can translate. */
    Function("getSupportedLanguages") {
      TranslateLanguage.getAllLanguages()
    }

    /** Language codes whose model is on the phone. */
    AsyncFunction("getDownloadedModels") { promise: Promise ->
      RemoteModelManager.getInstance()
        .getDownloadedModels(TranslateRemoteModel::class.java)
        .addOnSuccessListener { models -> promise.resolve(models.map { it.language }.sorted()) }
        .addOnFailureListener { error -> promise.reject("ERR_MODELS", error.message ?: "Cannot list models", error) }
    }

    AsyncFunction("downloadModel") { language: String, wifiOnly: Boolean, promise: Promise ->
      val code = TranslateLanguage.fromLanguageTag(language)
      if (code == null) {
        promise.reject("ERR_LANGUAGE", "Unsupported language $language", null)
        return@AsyncFunction
      }
      val conditions = DownloadConditions.Builder().apply { if (wifiOnly) requireWifi() }.build()
      RemoteModelManager.getInstance()
        .download(TranslateRemoteModel.Builder(code).build(), conditions)
        .addOnSuccessListener { promise.resolve(true) }
        .addOnFailureListener { error -> promise.reject("ERR_DOWNLOAD", error.message ?: "Download failed", error) }
    }

    AsyncFunction("deleteModel") { language: String, promise: Promise ->
      val code = TranslateLanguage.fromLanguageTag(language)
      if (code == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      RemoteModelManager.getInstance()
        .deleteDownloadedModel(TranslateRemoteModel.Builder(code).build())
        .addOnSuccessListener { promise.resolve(true) }
        .addOnFailureListener { error -> promise.reject("ERR_DELETE", error.message ?: "Delete failed", error) }
    }

    /**
     * Translates texts from one language to another. Fails with ERR_MODEL_MISSING when a
     * needed model is not on the phone: nothing is ever downloaded behind the user's back.
     */
    AsyncFunction("translate") { source: String, target: String, texts: List<String>, promise: Promise ->
      val engine = translator(source, target)
      val from = TranslateLanguage.fromLanguageTag(source)
      val to = TranslateLanguage.fromLanguageTag(target)
      if (engine == null || from == null || to == null) {
        promise.reject("ERR_LANGUAGE", "Unsupported language pair $source > $target", null)
        return@AsyncFunction
      }
      RemoteModelManager.getInstance()
        .getDownloadedModels(TranslateRemoteModel::class.java)
        .addOnSuccessListener { models ->
          val present = models.map { it.language }.toSet()
          // English is built in; every other language needs its model.
          val missing = listOf(from, to).filter { it != TranslateLanguage.ENGLISH && it !in present }
          if (missing.isNotEmpty()) {
            promise.reject("ERR_MODEL_MISSING", missing.joinToString(","), null)
          } else {
            translateAll(engine, texts, 0, ArrayList(texts.size), promise)
          }
        }
        .addOnFailureListener { error -> promise.reject("ERR_MODELS", error.message ?: "Cannot list models", error) }
    }
  }
}
