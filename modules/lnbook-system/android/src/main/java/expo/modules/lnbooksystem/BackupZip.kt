package expo.modules.lnbooksystem

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileNotFoundException
import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.util.zip.Deflater
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/**
 * Backup archives, written and read as streams: a file is never held in memory, whatever
 * the size of the library. Pure JVM code (no Android class), tested on the computer.
 *
 * Layout: `manifest.json` first, then `data/<table>.json`, `files/<path>` and, last,
 * `checksums.json` with the size and SHA-256 of every other entry.
 */
object BackupZip {
  const val CHECKSUMS = "checksums.json"
  private const val BUFFER = 256 * 1024
  private const val MAX_TEXT_ENTRY = 16L * 1024 * 1024

  /** Already compressed formats are stored as they are: compressing them again is slow for nothing. */
  private val STORED_EXTENSIONS = setOf(
    "jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "mp3", "m4a", "ogg", "zip", "epub", "woff", "woff2",
  )

  class Entry(val name: String, val file: File)

  class Progress(val bytes: Long, val totalBytes: Long, val entries: Int, val totalEntries: Int)

  class WriteResult(val size: Long, val entries: Int, val missing: List<String>)

  class ListedEntry(val name: String, val size: Long, val sha256: String)

  class ReadResult(
    val entries: List<ListedEntry>,
    val texts: Map<String, String>,
    val skipped: List<String>,
    val bytes: Long,
  )

  class CancelledException : IOException("Cancelled")

  /** Counts what goes through the output (the size of the archive). */
  private class CountingOutputStream(private val out: OutputStream) : OutputStream() {
    var count = 0L
    override fun write(b: Int) { out.write(b); count += 1 }
    override fun write(b: ByteArray, off: Int, len: Int) { out.write(b, off, len); count += len }
    override fun flush() = out.flush()
    override fun close() = out.close()
  }

  private class CountingInputStream(input: InputStream) : FilterInputStream(input) {
    var count = 0L
    override fun read(): Int = super.read().also { if (it >= 0) count += 1 }
    override fun read(b: ByteArray, off: Int, len: Int): Int =
      super.read(b, off, len).also { if (it > 0) count += it }
    override fun skip(n: Long): Long = super.skip(n).also { count += it }
  }

  fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }

  fun jsonString(value: String): String {
    val out = StringBuilder("\"")
    for (char in value) {
      when {
        char == '"' -> out.append("\\\"")
        char == '\\' -> out.append("\\\\")
        char < ' ' -> out.append("\\u%04x".format(char.code))
        else -> out.append(char)
      }
    }
    return out.append('"').toString()
  }

  private fun isStored(name: String): Boolean =
    name.substringAfterLast('/').substringAfterLast('.', "").lowercase() in STORED_EXTENSIONS

  /**
   * Writes the archive. A file that disappeared since it was listed (a chapter deleted
   * meanwhile) is left out and reported in `missing`; any other error stops everything.
   */
  fun write(
    output: OutputStream,
    entries: List<Entry>,
    cancelled: () -> Boolean = { false },
    onProgress: (Progress) -> Unit = {},
  ): WriteResult {
    val totalBytes = entries.sumOf { if (it.file.isFile) it.file.length() else 0L }
    val counting = CountingOutputStream(BufferedOutputStream(output, BUFFER))
    val zip = ZipOutputStream(counting)
    val checksums = StringBuilder("{\"algorithm\":\"SHA-256\",\"files\":{")
    val missing = mutableListOf<String>()
    val buffer = ByteArray(BUFFER)
    var bytes = 0L
    var written = 0
    var first = true
    zip.use {
      entries.forEachIndexed { index, entry ->
        if (cancelled()) throw CancelledException()
        val input = try {
          FileInputStream(entry.file)
        } catch (error: FileNotFoundException) {
          missing.add(entry.name)
          return@forEachIndexed
        }
        zip.setLevel(if (isStored(entry.name)) Deflater.NO_COMPRESSION else Deflater.DEFAULT_COMPRESSION)
        zip.putNextEntry(ZipEntry(entry.name).apply { time = entry.file.lastModified() })
        val digest = MessageDigest.getInstance("SHA-256")
        var size = 0L
        input.use { source ->
          while (true) {
            val read = source.read(buffer)
            if (read < 0) break
            zip.write(buffer, 0, read)
            digest.update(buffer, 0, read)
            size += read
            bytes += read
          }
        }
        zip.closeEntry()
        written += 1
        if (!first) checksums.append(',')
        first = false
        checksums.append(jsonString(entry.name))
          .append(":{\"size\":").append(size)
          .append(",\"sha256\":\"").append(hex(digest.digest())).append("\"}")
        onProgress(Progress(bytes, totalBytes, index + 1, entries.size))
      }
      checksums.append("}}")
      zip.setLevel(Deflater.DEFAULT_COMPRESSION)
      zip.putNextEntry(ZipEntry(CHECKSUMS))
      zip.write(checksums.toString().toByteArray(Charsets.UTF_8))
      zip.closeEntry()
      zip.finish()
      zip.flush()
    }
    return WriteResult(counting.count, written, missing)
  }

  /** Name of an entry that may be written under the destination folder, or null. */
  fun safeTarget(destination: File, name: String): File? {
    if (name.isEmpty() || name.startsWith("/") || name.contains('\\') || name.contains('\u0000')) return null
    if (name.split('/').any { it == ".." || it == "." }) return null
    val root = destination.canonicalFile
    val target = File(root, name).canonicalFile
    return if (target.path.startsWith(root.path + File.separator)) target else null
  }

  /**
   * Reads every entry and computes its SHA-256. With a destination folder, the entries
   * are also written there (unsafe names are skipped). The text of `manifest.json` and
   * `checksums.json` is returned.
   */
  fun read(
    input: InputStream,
    totalBytes: Long,
    destination: File?,
    cancelled: () -> Boolean = { false },
    onProgress: (Progress) -> Unit = {},
  ): ReadResult {
    val counting = CountingInputStream(BufferedInputStream(input, BUFFER))
    val zip = ZipInputStream(counting)
    val listed = mutableListOf<ListedEntry>()
    val texts = mutableMapOf<String, String>()
    val skipped = mutableListOf<String>()
    val buffer = ByteArray(BUFFER)
    zip.use {
      while (true) {
        if (cancelled()) throw CancelledException()
        val entry = zip.nextEntry ?: break
        if (entry.isDirectory) continue
        val name = entry.name
        val keepText = name == "manifest.json" || name == CHECKSUMS
        val target = destination?.let { safeTarget(it, name) }
        if (destination != null && target == null) {
          skipped.add(name)
        }
        target?.parentFile?.mkdirs()
        val out = target?.let { BufferedOutputStream(it.outputStream(), BUFFER) }
        val text = if (keepText) java.io.ByteArrayOutputStream() else null
        val digest = MessageDigest.getInstance("SHA-256")
        var size = 0L
        try {
          while (true) {
            val read = zip.read(buffer)
            if (read < 0) break
            digest.update(buffer, 0, read)
            out?.write(buffer, 0, read)
            if (text != null && size + read <= MAX_TEXT_ENTRY) text.write(buffer, 0, read)
            size += read
            if (cancelled()) throw CancelledException()
          }
        } finally {
          out?.close()
        }
        text?.let { texts[name] = it.toString("UTF-8") }
        listed.add(ListedEntry(name, size, hex(digest.digest())))
        onProgress(Progress(counting.count, totalBytes, listed.size, 0))
      }
    }
    return ReadResult(listed, texts, skipped, counting.count)
  }

  /** Moves a file or a folder; falls back to copy + delete across file systems. */
  fun move(from: File, to: File) {
    if (!from.exists()) throw FileNotFoundException(from.path)
    if (to.exists()) throw IOException("Destination already exists: ${to.path}")
    to.parentFile?.mkdirs()
    if (from.renameTo(to)) return
    if (!from.copyRecursively(to, overwrite = false)) throw IOException("Cannot copy ${from.path}")
    from.deleteRecursively()
  }
}
