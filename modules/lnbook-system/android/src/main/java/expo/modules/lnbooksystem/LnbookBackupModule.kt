package expo.modules.lnbooksystem

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.system.ErrnoException
import android.system.OsConstants
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileNotFoundException
import java.io.InputStream
import java.io.OutputStream
import java.util.zip.ZipException

/**
 * Backups written and read as streams, off the JavaScript thread. Paths of the app storage
 * are relative to its files directory; archives are file:// or content:// URIs (a folder
 * chosen with the Android picker, a file picked by the user).
 */
class LnbookBackupModule : Module() {
  @Volatile
  private var cancelRequested = false

  private val context: Context
    get() = appContext.reactContext ?: throw CodedException("ERR_BACKUP_IO", "No Android context", null)

  private fun storageFile(path: String): File {
    val root = context.filesDir.canonicalFile
    val file = File(root, path).canonicalFile
    if (file != root && !file.path.startsWith(root.path + File.separator)) {
      throw CodedException("ERR_BACKUP_IO", "Path outside the app storage: $path", null)
    }
    return file
  }

  private fun isFileUri(uri: Uri) = uri.scheme == "file" || uri.scheme == null

  private fun openOutput(uri: Uri): OutputStream =
    if (isFileUri(uri)) {
      File(uri.path!!).also { it.parentFile?.mkdirs() }.outputStream()
    } else {
      // "wt" truncates: a provider may otherwise keep the end of an older, longer file.
      // Some providers only know "w" (the document was just created, so it is empty).
      val stream = try {
        context.contentResolver.openOutputStream(uri, "wt")
      } catch (error: IllegalArgumentException) {
        context.contentResolver.openOutputStream(uri, "w")
      } catch (error: UnsupportedOperationException) {
        context.contentResolver.openOutputStream(uri, "w")
      }
      stream ?: throw FileNotFoundException("Cannot open $uri for writing")
    }

  private fun openInput(uri: Uri): Pair<InputStream, Long> =
    if (isFileUri(uri)) {
      val file = File(uri.path!!)
      Pair(file.inputStream(), file.length())
    } else {
      var size = -1L
      try {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
          if (cursor.moveToFirst() && !cursor.isNull(0)) size = cursor.getLong(0)
        }
      } catch (error: Exception) {
        size = -1L
      }
      val stream = context.contentResolver.openInputStream(uri)
        ?: throw FileNotFoundException("Cannot open $uri for reading")
      Pair(stream, size)
    }

  private fun isNoSpace(error: Throwable?): Boolean {
    var current = error
    while (current != null) {
      if (current is ErrnoException && current.errno == OsConstants.ENOSPC) return true
      val message = current.message ?: ""
      if (message.contains("ENOSPC") || message.contains("No space left", ignoreCase = true)) return true
      current = current.cause
    }
    return false
  }

  /** Turns any failure into an error whose code tells JavaScript what to say to the user. */
  private fun describe(error: Throwable): CodedException {
    if (error is CodedException) return error
    val detail = "${error.javaClass.simpleName}: ${error.message ?: "no message"}"
    val code = when {
      error is BackupZip.CancelledException -> "ERR_BACKUP_CANCELLED"
      isNoSpace(error) -> "ERR_BACKUP_NO_SPACE"
      error is SecurityException -> "ERR_BACKUP_PERMISSION"
      error is FileNotFoundException -> "ERR_BACKUP_NOT_FOUND"
      error is ZipException -> "ERR_BACKUP_CORRUPTED"
      error is OutOfMemoryError -> "ERR_BACKUP_MEMORY"
      else -> "ERR_BACKUP_IO"
    }
    return CodedException(code, detail, error)
  }

  private fun progressSender(phase: String): (BackupZip.Progress) -> Unit {
    var last = 0L
    return { progress ->
      val now = System.currentTimeMillis()
      if (now - last >= 200 || progress.bytes >= progress.totalBytes) {
        last = now
        sendEvent(
          "onBackupProgress",
          mapOf(
            "phase" to phase,
            "bytes" to progress.bytes.toDouble(),
            "totalBytes" to progress.totalBytes.toDouble(),
            "entries" to progress.entries,
            "totalEntries" to progress.totalEntries,
          ),
        )
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("LnbookBackup")

    Events("onBackupProgress")

    Function("cancelBackupWork") {
      cancelRequested = true
    }

    // names[i] is the name inside the archive of the file paths[i] (relative to the storage).
    AsyncFunction("writeBackupZip") { output: String, names: List<String>, paths: List<String> ->
      cancelRequested = false
      if (names.size != paths.size) throw CodedException("ERR_BACKUP_IO", "names and paths differ", null)
      val uri = Uri.parse(output)
      // A file is written next to its final name and renamed at the end: an interrupted
      // backup never replaces a good one.
      val finalFile = if (isFileUri(uri)) File(uri.path!!) else null
      val partFile = finalFile?.let { File(it.path + ".part") }
      try {
        val entries = names.indices.map { BackupZip.Entry(names[it], storageFile(paths[it])) }
        val stream = if (partFile != null) {
          partFile.parentFile?.mkdirs()
          partFile.outputStream()
        } else {
          openOutput(uri)
        }
        val result = BackupZip.write(stream, entries, { cancelRequested }, progressSender("write"))
        if (partFile != null && finalFile != null) {
          if (finalFile.exists() && !finalFile.delete()) throw java.io.IOException("Cannot replace ${finalFile.path}")
          if (!partFile.renameTo(finalFile)) throw java.io.IOException("Cannot rename ${partFile.path}")
        }
        mapOf(
          "size" to result.size.toDouble(),
          "entries" to result.entries,
          "missing" to result.missing,
        )
      } catch (error: Throwable) {
        partFile?.delete()
        if (finalFile == null) {
          // Half a document in the chosen folder would look like a backup: remove it.
          try {
            DocumentsContract.deleteDocument(context.contentResolver, uri)
          } catch (ignored: Exception) {
          }
        }
        throw describe(error)
      }
    }

    // Reads an archive (checksums of every entry); with `extractTo`, also writes it there.
    AsyncFunction("readBackupZip") { input: String, extractTo: String? ->
      cancelRequested = false
      val destination = extractTo?.let { storageFile(it) }
      try {
        destination?.mkdirs()
        val (stream, size) = openInput(Uri.parse(input))
        val result = BackupZip.read(stream, size, destination, { cancelRequested }, progressSender("read"))
        mapOf(
          "entries" to result.entries.map { mapOf("name" to it.name, "size" to it.size.toDouble(), "sha256" to it.sha256) },
          "manifest" to result.texts["manifest.json"],
          "checksums" to result.texts[BackupZip.CHECKSUMS],
          "skipped" to result.skipped,
          "bytes" to result.bytes.toDouble(),
        )
      } catch (error: Throwable) {
        destination?.deleteRecursively()
        throw describe(error)
      }
    }

    // Renames inside the app storage (a restore swaps whole folders this way).
    Function("movePath") { from: String, to: String ->
      try {
        BackupZip.move(storageFile(from), storageFile(to))
      } catch (error: Throwable) {
        throw describe(error)
      }
    }

    Function("deleteDocument") { uri: String ->
      try {
        DocumentsContract.deleteDocument(context.contentResolver, Uri.parse(uri))
      } catch (error: Exception) {
        false
      }
    }
  }
}
