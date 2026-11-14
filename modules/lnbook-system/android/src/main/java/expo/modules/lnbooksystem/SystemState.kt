package expo.modules.lnbooksystem

/**
 * State shared between the activity hooks (which exist before JavaScript starts) and the
 * module exposed to JavaScript.
 */
internal object SystemState {
  /** True while the reader wants the volume buttons to turn pages. */
  @Volatile
  var volumeKeysEnabled = false

  /** Called with "up" or "down" when a volume button is used to turn a page. */
  @Volatile
  var onVolumeKey: ((String) -> Unit)? = null

  /** Called when files arrive while the app is running. */
  @Volatile
  var onIncomingFiles: (() -> Unit)? = null

  private val pendingFiles = mutableListOf<IncomingFile>()

  fun addFiles(files: List<IncomingFile>) {
    if (files.isEmpty()) return
    synchronized(pendingFiles) { pendingFiles.addAll(files) }
    onIncomingFiles?.invoke()
  }

  /** Returns the files received since the last call and forgets them. */
  fun takeFiles(): List<IncomingFile> = synchronized(pendingFiles) {
    val copy = pendingFiles.toList()
    pendingFiles.clear()
    copy
  }
}

internal data class IncomingFile(val uri: String, val name: String)
