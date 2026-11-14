package expo.modules.lnbooksystem

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import java.util.Locale

/**
 * Reads a list of sentences aloud with the Android speech engine. It lives outside the
 * activity, so reading continues with the screen off; JavaScript only gives the sentences
 * of a chapter and is told when the chapter is finished.
 *
 * Everything runs on the main thread.
 */
internal object TtsPlayer {
  const val STOPPED = "stopped"
  const val PLAYING = "playing"
  const val PAUSED = "paused"

  /** Seconds over which the sound fades before the sleep timer stops the voice. */
  private const val FADE_MS = 30_000L
  /** Time left to JavaScript to give the next chapter before the service closes. */
  private const val NEXT_CHAPTER_TIMEOUT_MS = 45_000L

  private val main = Handler(Looper.getMainLooper())
  private var appContext: Context? = null

  /** Sends an event to JavaScript. */
  @Volatile
  var emit: ((String, Map<String, Any?>) -> Unit)? = null

  private var tts: TextToSpeech? = null
  private var engineName: String? = null
  private var engineReady = false
  private val whenReady = mutableListOf<(Boolean) -> Unit>()

  private var sentences: List<String> = emptyList()
  private var endsBlock: List<Boolean> = emptyList()
  var index = 0
    private set
  var state = STOPPED
    private set
  /** Changes every time the queue of the engine is rebuilt: late callbacks are ignored. */
  private var generation = 0
  private var queuedUpTo = -1
  private var finished = false

  private var rate = 1f
  private var pitch = 1f
  private var pauseMs = 300L
  private var voiceId: String? = null
  private var language: String? = null

  var title = ""
    private set
  var subtitle = ""
    private set
  var cover: Bitmap? = null
    private set
  var hasNext = false
    private set
  var hasPrevious = false
    private set
  var labels: Map<String, String> = emptyMap()
    private set

  private var sleepDeadline = 0L
  private var session: MediaSession? = null
  private var focusRequest: AudioFocusRequest? = null
  private var resumeOnFocus = false
  private var noisyRegistered = false

  val sessionToken: MediaSession.Token?
    get() = session?.sessionToken

  fun runOnMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block)
  }

  // ------------------------------------------------------------------ engine

  private fun ensureEngine(context: Context, engine: String?, then: (Boolean) -> Unit) {
    appContext = context.applicationContext
    val wanted = engine?.takeIf { it.isNotBlank() }
    if (tts != null && wanted == engineName) {
      if (engineReady) then(true) else whenReady.add(then)
      return
    }
    tts?.shutdown()
    engineReady = false
    engineName = wanted
    whenReady.add(then)
    val listener = TextToSpeech.OnInitListener { status ->
      runOnMain {
        engineReady = status == TextToSpeech.SUCCESS
        if (engineReady) {
          tts?.setOnUtteranceProgressListener(progressListener)
          tts?.setAudioAttributes(
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_MEDIA)
              .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
              .build(),
          )
        }
        val waiting = whenReady.toList()
        whenReady.clear()
        waiting.forEach { it(engineReady) }
      }
    }
    tts = if (wanted != null) {
      TextToSpeech(context.applicationContext, listener, wanted)
    } else {
      TextToSpeech(context.applicationContext, listener)
    }
  }

  fun engines(context: Context, then: (List<Map<String, Any?>>) -> Unit) {
    ensureEngine(context, engineName) { ok ->
      val engine = tts
      if (!ok || engine == null) {
        then(emptyList())
      } else {
        val default = engine.defaultEngine
        then(engine.engines.map { mapOf("name" to it.name, "label" to it.label, "isDefault" to (it.name == default)) })
      }
    }
  }

  fun voices(context: Context, engine: String?, then: (List<Map<String, Any?>>) -> Unit) {
    ensureEngine(context, engine) { ok ->
      val list = try {
        if (ok) tts?.voices?.toList() ?: emptyList() else emptyList()
      } catch (_: Exception) {
        emptyList<Voice>()
      }
      then(
        list.map { voice ->
          mapOf(
            "id" to voice.name,
            "locale" to voice.locale.toLanguageTag(),
            "quality" to voice.quality,
            "network" to voice.isNetworkConnectionRequired,
            "installed" to !(voice.features?.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) ?: false),
          )
        },
      )
    }
  }

  private fun applyVoice() {
    val engine = tts ?: return
    engine.setSpeechRate(rate)
    engine.setPitch(pitch)
    try {
      val voice = voiceId?.let { id -> engine.voices?.firstOrNull { it.name == id } }
      if (voice != null) {
        engine.voice = voice
      } else {
        language?.takeIf { it.isNotBlank() }?.let { engine.language = Locale.forLanguageTag(it) }
      }
    } catch (_: Exception) {
      // The engine keeps its current voice.
    }
  }

  // ------------------------------------------------------------------ queue

  private fun utteranceId(i: Int) = "$generation:$i"

  private fun volumeNow(): Float {
    if (sleepDeadline == 0L) return 1f
    val left = sleepDeadline - SystemClock.elapsedRealtime()
    return if (left >= FADE_MS) 1f else (left.toFloat() / FADE_MS).coerceIn(0.08f, 1f)
  }

  private fun enqueue(i: Int, flush: Boolean) {
    val engine = tts ?: return
    if (i < 0 || i >= sentences.size) return
    val params = Bundle()
    params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, volumeNow())
    engine.speak(sentences[i], if (flush) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD, params, utteranceId(i))
    if (endsBlock.getOrNull(i) == true && pauseMs > 0) {
      engine.playSilentUtterance(pauseMs, TextToSpeech.QUEUE_ADD, "${utteranceId(i)}:pause")
    }
    queuedUpTo = i
  }

  private fun speakFrom(i: Int) {
    generation += 1
    finished = false
    index = i.coerceIn(0, maxOf(0, sentences.size - 1))
    applyVoice()
    enqueue(index, true)
    // The next sentence is queued in advance, so that there is no gap between two.
    enqueue(index + 1, false)
  }

  private val progressListener = object : UtteranceProgressListener() {
    private fun parse(id: String?): Pair<Int, Int>? {
      val parts = id?.split(":") ?: return null
      if (parts.size != 2) return null
      val g = parts[0].toIntOrNull() ?: return null
      val i = parts[1].toIntOrNull() ?: return null
      return Pair(g, i)
    }

    override fun onStart(utteranceId: String?) {
      val (g, i) = parse(utteranceId) ?: return
      runOnMain {
        if (g != generation || state != PLAYING) return@runOnMain
        index = i
        if (queuedUpTo < i + 1) enqueue(i + 1, false)
        emit?.invoke("onTtsSentence", mapOf("index" to i))
      }
    }

    override fun onDone(utteranceId: String?) {
      val (g, i) = parse(utteranceId) ?: return
      runOnMain {
        if (g != generation || state != PLAYING) return@runOnMain
        if (i >= sentences.size - 1) chapterFinished()
      }
    }

    @Deprecated("Deprecated in Java")
    override fun onError(utteranceId: String?) {
      onError(utteranceId, TextToSpeech.ERROR)
    }

    override fun onError(utteranceId: String?, errorCode: Int) {
      val (g, i) = parse(utteranceId) ?: return
      runOnMain {
        if (g != generation || state != PLAYING) return@runOnMain
        // A sentence the engine cannot say is skipped; the chapter goes on.
        if (i >= sentences.size - 1) chapterFinished()
        else if (queuedUpTo < i + 1) enqueue(i + 1, false)
      }
    }
  }

  private val nextChapterTimeout = Runnable {
    if (finished && state == PLAYING) stop()
  }

  private fun chapterFinished() {
    finished = true
    emit?.invoke("onTtsFinished", emptyMap())
    main.removeCallbacks(nextChapterTimeout)
    main.postDelayed(nextChapterTimeout, NEXT_CHAPTER_TIMEOUT_MS)
  }

  // ------------------------------------------------------------------ commands

  fun configure(newRate: Float, newPitch: Float, newPauseMs: Long, newVoice: String?, newLanguage: String?) {
    val changed = newRate != rate || newPitch != pitch || newVoice != voiceId || newLanguage != language
    rate = newRate.coerceIn(0.1f, 4f)
    pitch = newPitch.coerceIn(0.1f, 2f)
    pauseMs = newPauseMs.coerceIn(0L, 5000L)
    voiceId = newVoice
    language = newLanguage
    // Applied right away: the sentence being read starts again with the new voice.
    if (changed && state == PLAYING && !finished) speakFrom(index)
  }

  /** Gives the sentences of a chapter and, with `autoplay`, starts reading at `start`. */
  fun load(
    context: Context,
    engine: String?,
    list: List<String>,
    blockEnds: List<Boolean>,
    start: Int,
    autoplay: Boolean,
    newTitle: String,
    newSubtitle: String,
    coverPath: String?,
    next: Boolean,
    previous: Boolean,
    newLabels: Map<String, String>,
    then: (Boolean) -> Unit,
  ) {
    main.removeCallbacks(nextChapterTimeout)
    ensureEngine(context, engine) { ok ->
      if (!ok) {
        emit?.invoke("onTtsError", mapOf("reason" to "engine"))
        then(false)
        return@ensureEngine
      }
      sentences = list
      endsBlock = blockEnds
      title = newTitle
      subtitle = newSubtitle
      hasNext = next
      hasPrevious = previous
      labels = newLabels
      cover = coverPath?.let { path ->
        try {
          val options = BitmapFactory.Options().apply { inSampleSize = 2 }
          BitmapFactory.decodeFile(path, options)
        } catch (_: Exception) {
          null
        }
      }
      index = start.coerceIn(0, maxOf(0, list.size - 1))
      finished = false
      ensureSession(context)
      if (autoplay && list.isNotEmpty()) {
        if (!requestFocus(context)) {
          setState(PAUSED)
        } else {
          setState(PLAYING)
          speakFrom(index)
        }
      } else {
        generation += 1
        tts?.stop()
        setState(PAUSED)
      }
      TtsService.start(context)
      then(true)
    }
  }

  fun play() {
    val context = appContext ?: return
    if (state == STOPPED || sentences.isEmpty()) return
    if (!requestFocus(context)) return
    resumeOnFocus = false
    setState(PLAYING)
    if (finished) chapterFinished() else speakFrom(index)
  }

  fun pause(keepFocus: Boolean = false) {
    if (state != PLAYING) return
    generation += 1
    tts?.stop()
    main.removeCallbacks(nextChapterTimeout)
    setState(PAUSED)
    if (!keepFocus) abandonFocus()
  }

  fun seekTo(i: Int) {
    if (state == STOPPED || sentences.isEmpty()) return
    index = i.coerceIn(0, sentences.size - 1)
    finished = false
    if (state == PLAYING) speakFrom(index) else emit?.invoke("onTtsSentence", mapOf("index" to index))
  }

  fun stop() {
    generation += 1
    try {
      tts?.stop()
    } catch (_: Exception) {
    }
    main.removeCallbacks(nextChapterTimeout)
    main.removeCallbacks(sleepRunnable)
    sleepDeadline = 0L
    abandonFocus()
    resumeOnFocus = false
    sentences = emptyList()
    endsBlock = emptyList()
    setState(STOPPED)
    session?.isActive = false
    session?.release()
    session = null
    appContext?.let { TtsService.stop(it) }
  }

  /** Says a short text with a given voice (settings screen); ignored while reading. */
  fun sample(context: Context, engine: String?, text: String, voice: String?, lang: String?, sampleRate: Float, samplePitch: Float) {
    if (state == PLAYING) return
    ensureEngine(context, engine) { ok ->
      val speech = tts
      if (!ok || speech == null) return@ensureEngine
      val savedVoice = voiceId
      val savedLanguage = language
      val savedRate = rate
      val savedPitch = pitch
      voiceId = voice
      language = lang
      rate = sampleRate
      pitch = samplePitch
      applyVoice()
      voiceId = savedVoice
      language = savedLanguage
      rate = savedRate
      pitch = savedPitch
      speech.speak(text, TextToSpeech.QUEUE_FLUSH, Bundle(), "sample")
    }
  }

  // ------------------------------------------------------------------ sleep timer

  private val sleepRunnable = Runnable {
    sleepDeadline = 0L
    pause()
    emit?.invoke("onTtsSleep", emptyMap())
  }

  /** Stops the voice after `ms` milliseconds (0 cancels), fading the sound at the end. */
  fun setSleepTimer(ms: Long) {
    main.removeCallbacks(sleepRunnable)
    if (ms <= 0) {
      sleepDeadline = 0L
      return
    }
    sleepDeadline = SystemClock.elapsedRealtime() + ms
    main.postDelayed(sleepRunnable, ms)
  }

  fun sleepRemainingMs(): Long =
    if (sleepDeadline == 0L) 0L else maxOf(0L, sleepDeadline - SystemClock.elapsedRealtime())

  // ------------------------------------------------------------------ state, session

  private fun setState(next: String) {
    state = next
    updateSession()
    val context = appContext
    if (context != null) {
      if (next == PLAYING) registerNoisy(context) else unregisterNoisy(context)
      if (next != STOPPED) TtsService.refresh(context)
    }
    emit?.invoke("onTtsState", mapOf("state" to next, "index" to index))
  }

  private fun ensureSession(context: Context) {
    if (session == null) {
      val created = MediaSession(context.applicationContext, "LNBookVoice")
      created.setCallback(
        object : MediaSession.Callback() {
          override fun onPlay() = play()
          override fun onPause() = pause()
          override fun onStop() = stop()
          override fun onSkipToNext() = command("next")
          override fun onSkipToPrevious() = command("previous")
        },
        main,
      )
      session = created
    }
    session?.isActive = true
    val metadata = MediaMetadata.Builder()
      .putString(MediaMetadata.METADATA_KEY_TITLE, subtitle)
      .putString(MediaMetadata.METADATA_KEY_ARTIST, title)
      .putString(MediaMetadata.METADATA_KEY_ALBUM, title)
    cover?.let { metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, it) }
    session?.setMetadata(metadata.build())
  }

  private fun updateSession() {
    var actions = PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_STOP or
      (if (state == PLAYING) PlaybackState.ACTION_PAUSE else PlaybackState.ACTION_PLAY)
    if (hasNext) actions = actions or PlaybackState.ACTION_SKIP_TO_NEXT
    if (hasPrevious) actions = actions or PlaybackState.ACTION_SKIP_TO_PREVIOUS
    val playback = when (state) {
      PLAYING -> PlaybackState.STATE_PLAYING
      PAUSED -> PlaybackState.STATE_PAUSED
      else -> PlaybackState.STATE_STOPPED
    }
    session?.setPlaybackState(
      PlaybackState.Builder()
        .setActions(actions)
        .setState(playback, PlaybackState.PLAYBACK_POSITION_UNKNOWN, if (state == PLAYING) 1f else 0f)
        .build(),
    )
  }

  /** "next" / "previous" chapter, asked from the notification or a headset. */
  fun command(name: String) {
    emit?.invoke("onTtsCommand", mapOf("command" to name))
  }

  // ------------------------------------------------------------------ audio focus

  private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
    runOnMain {
      when (change) {
        AudioManager.AUDIOFOCUS_GAIN -> if (resumeOnFocus && state == PAUSED) {
          resumeOnFocus = false
          setState(PLAYING)
          speakFrom(index)
        }
        // A call, a navigation instruction, another app for a moment: reading resumes after.
        AudioManager.AUDIOFOCUS_LOSS_TRANSIENT, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK ->
          if (state == PLAYING) {
            pause(keepFocus = true)
            resumeOnFocus = true
          }
        AudioManager.AUDIOFOCUS_LOSS -> {
          resumeOnFocus = false
          pause()
        }
      }
    }
  }

  private fun requestFocus(context: Context): Boolean {
    val audio = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return true
    val request = focusRequest ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build(),
      )
      .setOnAudioFocusChangeListener(focusListener, main)
      .build()
      .also { focusRequest = it }
    return audio.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
  }

  private fun abandonFocus() {
    val audio = appContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
    focusRequest?.let { audio.abandonAudioFocusRequest(it) }
  }

  // Headphones unplugged or Bluetooth headset disconnected: the voice must not continue
  // on the speaker.
  private val noisyReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) runOnMain { pause() }
    }
  }

  private fun registerNoisy(context: Context) {
    if (noisyRegistered) return
    context.applicationContext.registerReceiver(noisyReceiver, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY))
    noisyRegistered = true
  }

  private fun unregisterNoisy(context: Context) {
    if (!noisyRegistered) return
    try {
      context.applicationContext.unregisterReceiver(noisyReceiver)
    } catch (_: Exception) {
    }
    noisyRegistered = false
  }
}
