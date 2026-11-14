package expo.modules.lnbooksystem

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** Download and installation of a new version of the app. */
internal object AppUpdate {
  private const val MAX_REDIRECTS = 5

  fun updatesDirectory(context: Context): File = File(context.cacheDir, "updates").also { it.mkdirs() }

  /**
   * Downloads a file into the updates directory and returns its SHA-256, computed while
   * the bytes arrive. `onProgress` receives the bytes received and the expected total
   * (0 when the server does not say).
   */
  fun download(context: Context, address: String, name: String, onProgress: (Long, Long) -> Unit): Map<String, Any> {
    val directory = updatesDirectory(context)
    // Older downloads are useless once a new one starts.
    directory.listFiles()?.forEach { it.delete() }
    val safeName = name.replace(Regex("[^A-Za-z0-9._-]"), "_").takeLast(80)
    val target = File(directory, safeName)

    var url = URL(address)
    var connection: HttpURLConnection
    var redirects = 0
    while (true) {
      if (url.protocol != "https") throw IllegalStateException("Only https downloads are allowed")
      connection = url.openConnection() as HttpURLConnection
      connection.connectTimeout = 30_000
      connection.readTimeout = 60_000
      connection.instanceFollowRedirects = false
      connection.setRequestProperty("Accept", "application/octet-stream")
      val status = connection.responseCode
      if (status in 300..399) {
        val location = connection.getHeaderField("Location")
        connection.disconnect()
        redirects += 1
        if (location == null || redirects > MAX_REDIRECTS) throw IllegalStateException("Too many redirects")
        url = URL(url, location)
        continue
      }
      if (status != 200) {
        connection.disconnect()
        throw IllegalStateException("HTTP $status")
      }
      break
    }

    val digest = MessageDigest.getInstance("SHA-256")
    val total = connection.contentLengthLong.coerceAtLeast(0)
    var received = 0L
    var lastReport = 0L
    try {
      connection.inputStream.use { input ->
        target.outputStream().use { output ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            output.write(buffer, 0, count)
            digest.update(buffer, 0, count)
            received += count
            val now = System.currentTimeMillis()
            if (now - lastReport >= 200) {
              lastReport = now
              onProgress(received, total)
            }
          }
        }
      }
    } catch (error: Exception) {
      target.delete()
      throw error
    } finally {
      connection.disconnect()
    }
    onProgress(received, total)
    val hash = digest.digest().joinToString("") { "%02x".format(it) }
    return mapOf("path" to target.absolutePath, "sha256" to hash, "size" to received.toDouble())
  }

  fun canInstall(context: Context): Boolean = context.packageManager.canRequestPackageInstalls()

  /** Opens the "Install unknown apps" setting of this app. */
  fun openInstallSettings(context: Context) {
    val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
  }

  /** Hands a downloaded APK to the Android installer. */
  fun install(context: Context, path: String) {
    val file = File(path)
    val directory = updatesDirectory(context).canonicalFile
    if (!file.exists() || file.canonicalFile.parentFile != directory) {
      throw IllegalStateException("Not a downloaded update")
    }
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.lnbookfiles", file)
    val intent = Intent(Intent.ACTION_VIEW)
      .setDataAndType(uri, "application/vnd.android.package-archive")
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    if (Build.VERSION.SDK_INT < 29) {
      @Suppress("DEPRECATION")
      intent.putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true)
    }
    context.startActivity(intent)
  }
}
