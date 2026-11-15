package expo.modules.lnbooksystem

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
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

  private const val ACTION_INSTALL_STATUS = "expo.modules.lnbooksystem.INSTALL_STATUS"
  private var receiver: BroadcastReceiver? = null

  private fun checkedFile(context: Context, path: String): File {
    val file = File(path)
    val directory = updatesDirectory(context).canonicalFile
    if (!file.exists() || file.canonicalFile.parentFile != directory) {
      throw IllegalStateException("Not a downloaded update")
    }
    return file
  }

  /**
   * Installs a downloaded APK through a PackageInstaller session: Android shows its
   * confirmation, then reports the result (`onStatus(status, message)`), so that a
   * refused installation is explained instead of failing silently.
   * Status: "confirm" (the confirmation screen is open), "success", "failure",
   * "aborted" (cancelled by the user), "blocked", "conflict", "incompatible",
   * "invalid", "storage".
   */
  fun installWithSession(context: Context, path: String, onStatus: (String, String?) -> Unit) {
    val file = checkedFile(context, path)
    val application = context.applicationContext
    receiver?.let { runCatching { application.unregisterReceiver(it) } }
    val statusReceiver = object : BroadcastReceiver() {
      override fun onReceive(received: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
          @Suppress("DEPRECATION")
          val confirm = if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
          } else {
            intent.getParcelableExtra(Intent.EXTRA_INTENT)
          }
          if (confirm != null) {
            confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
              received.startActivity(confirm)
              onStatus("confirm", null)
            } catch (error: Exception) {
              onStatus("failure", error.message)
            }
          } else {
            onStatus("failure", message)
          }
          return
        }
        onStatus(
          when (status) {
            PackageInstaller.STATUS_SUCCESS -> "success"
            PackageInstaller.STATUS_FAILURE_ABORTED -> "aborted"
            PackageInstaller.STATUS_FAILURE_BLOCKED -> "blocked"
            PackageInstaller.STATUS_FAILURE_CONFLICT -> "conflict"
            PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "incompatible"
            PackageInstaller.STATUS_FAILURE_INVALID -> "invalid"
            PackageInstaller.STATUS_FAILURE_STORAGE -> "storage"
            else -> "failure"
          },
          message,
        )
      }
    }
    ContextCompat.registerReceiver(
      application,
      statusReceiver,
      IntentFilter(ACTION_INSTALL_STATUS),
      ContextCompat.RECEIVER_NOT_EXPORTED,
    )
    receiver = statusReceiver

    val installer = application.packageManager.packageInstaller
    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
    params.setAppPackageName(application.packageName)
    params.setSize(file.length())
    if (Build.VERSION.SDK_INT >= 26) {
      params.setInstallReason(android.content.pm.PackageManager.INSTALL_REASON_USER)
    }
    val sessionId = installer.createSession(params)
    installer.openSession(sessionId).use { session ->
      try {
        file.inputStream().use { input ->
          session.openWrite("base.apk", 0, file.length()).use { output ->
            input.copyTo(output, 64 * 1024)
            session.fsync(output)
          }
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
          (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
        val pending = PendingIntent.getBroadcast(
          application,
          sessionId,
          Intent(ACTION_INSTALL_STATUS).setPackage(application.packageName),
          flags,
        )
        session.commit(pending.intentSender)
      } catch (error: Exception) {
        session.abandon()
        throw error
      }
    }
  }

  /** Older way: hands the APK to the installer screen (used when a session cannot be made). */
  fun install(context: Context, path: String) {
    val file = checkedFile(context, path)
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

  /** Removes downloaded updates (once installed, they only take space). */
  fun clearDownloads(context: Context) {
    updatesDirectory(context).listFiles()?.forEach { it.delete() }
  }
}
