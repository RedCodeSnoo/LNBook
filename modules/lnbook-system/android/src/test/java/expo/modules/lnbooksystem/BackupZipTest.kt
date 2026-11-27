package expo.modules.lnbooksystem

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.Random
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class BackupZipTest {
  @get:Rule
  val temp = TemporaryFolder()

  private fun sha256(bytes: ByteArray) = BackupZip.hex(MessageDigest.getInstance("SHA-256").digest(bytes))

  private fun file(root: File, path: String, content: ByteArray): File =
    File(root, path).also {
      it.parentFile.mkdirs()
      it.writeBytes(content)
    }

  @Test
  fun writesEveryEntryWithItsChecksumAndReadsItBack() {
    val storage = temp.newFolder("storage")
    val contents = linkedMapOf(
      "manifest.json" to "{\"app\":\"LNBook\"}".toByteArray(),
      "data/novels.json" to "[{\"id\":1,\"title\":\"Été\"}]".toByteArray(),
      "files/novels/1/chapters/10.html" to "<p>Bonjour « monde »</p>".repeat(500).toByteArray(),
      // Special characters, spaces and an already compressed format.
      "files/novels/1/images/Image n°1 (été) #2.jpg" to ByteArray(70_000) { (it * 31).toByte() },
      "files/novels/1/empty.css" to ByteArray(0),
    )
    val entries = contents.map { (name, bytes) ->
      BackupZip.Entry(name, file(storage, "src/$name", bytes))
    }
    val out = ByteArrayOutputStream()
    val written = BackupZip.write(out, entries)
    assertEquals(contents.size, written.entries)
    assertTrue(written.missing.isEmpty())
    assertEquals(out.size().toLong(), written.size)

    val destination = temp.newFolder("extracted")
    val read = BackupZip.read(ByteArrayInputStream(out.toByteArray()), out.size().toLong(), destination)
    assertEquals(contents.keys.toList() + BackupZip.CHECKSUMS, read.entries.map { it.name })
    for ((name, bytes) in contents) {
      val listed = read.entries.first { it.name == name }
      assertEquals(bytes.size.toLong(), listed.size)
      assertEquals(sha256(bytes), listed.sha256)
      assertArrayEquals(bytes, File(destination, name).readBytes())
    }
    assertEquals("{\"app\":\"LNBook\"}", read.texts["manifest.json"])
    val checksums = read.texts[BackupZip.CHECKSUMS]
    assertNotNull(checksums)
    for ((name, bytes) in contents) {
      assertTrue(checksums!!.contains("${BackupZip.jsonString(name)}:{\"size\":${bytes.size},\"sha256\":\"${sha256(bytes)}\"}"))
    }
  }

  @Test
  fun leavesOutAFileDeletedMeanwhile() {
    val storage = temp.newFolder("storage")
    val kept = file(storage, "a.html", "a".toByteArray())
    val gone = File(storage, "gone.html")
    val out = ByteArrayOutputStream()
    val written = BackupZip.write(out, listOf(BackupZip.Entry("files/a.html", kept), BackupZip.Entry("files/gone.html", gone)))
    assertEquals(listOf("files/gone.html"), written.missing)
    val read = BackupZip.read(ByteArrayInputStream(out.toByteArray()), -1, null)
    assertEquals(listOf("files/a.html", BackupZip.CHECKSUMS), read.entries.map { it.name })
    assertFalse(read.texts[BackupZip.CHECKSUMS]!!.contains("gone"))
  }

  @Test
  fun neverWritesOutsideTheDestination() {
    val zipped = ByteArrayOutputStream()
    ZipOutputStream(zipped).use { zip ->
      for (name in listOf("../evil.txt", "files/../../evil2.txt", "/abs.txt", "files/ok.txt", "files/./dot.txt")) {
        zip.putNextEntry(ZipEntry(name))
        zip.write("x".toByteArray())
        zip.closeEntry()
      }
    }
    val parent = temp.newFolder("parent")
    val destination = File(parent, "dest").also { it.mkdirs() }
    val read = BackupZip.read(ByteArrayInputStream(zipped.toByteArray()), -1, destination)
    assertEquals(listOf("../evil.txt", "files/../../evil2.txt", "/abs.txt", "files/./dot.txt"), read.skipped)
    assertTrue(File(destination, "files/ok.txt").isFile)
    assertFalse(File(parent, "evil.txt").exists())
    assertFalse(File(temp.root, "evil2.txt").exists())
  }

  @Test
  fun readsABackupMadeByApp110() {
    val legacy = javaClass.classLoader!!.getResourceAsStream("legacy-1.1.0.zip")
    assertNotNull(legacy)
    val destination = temp.newFolder("legacy")
    val read = BackupZip.read(legacy!!, -1, destination)
    assertTrue(read.texts["manifest.json"]!!.contains("\"appVersion\": \"1.1.0\""))
    assertNull(read.texts[BackupZip.CHECKSUMS])
    assertTrue(read.entries.any { it.name == "data/reading_sessions.json" })
    assertEquals("<p>Bonjour « monde »</p>", File(destination, "files/novels/1/chapters/10.html").readText())
    assertArrayEquals(
      byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47),
      File(destination, "files/novels/1/images/Image n°1 (été).png").readBytes(),
    )
    assertTrue(File(destination, "data/novels.json").readText().contains("Été à Kyōto"))
  }

  @Test
  fun stopsWhenCancelled() {
    val storage = temp.newFolder("storage")
    val entries = (1..5).map { BackupZip.Entry("files/$it.html", file(storage, "$it.html", "x".toByteArray())) }
    var calls = 0
    try {
      BackupZip.write(ByteArrayOutputStream(), entries, { (calls++) >= 2 })
      fail("should have been cancelled")
    } catch (expected: BackupZip.CancelledException) {
    }
  }

  @Test
  fun movesFoldersAndRefusesToOverwrite() {
    val root = temp.newFolder("root")
    file(root, "novels/1/chapters/1.html", "one".toByteArray())
    BackupZip.move(File(root, "novels"), File(root, ".backup-work/r/previous/novels"))
    assertFalse(File(root, "novels").exists())
    assertEquals("one", File(root, ".backup-work/r/previous/novels/1/chapters/1.html").readText())
    file(root, "other/x.txt", "x".toByteArray())
    try {
      BackupZip.move(File(root, "other"), File(root, ".backup-work/r/previous/novels"))
      fail("should refuse an existing destination")
    } catch (expected: java.io.IOException) {
    }
  }

  /**
   * A library of several hundred megabytes with a Java heap of 64 MB (set in build.gradle):
   * app 1.1.0 needed the whole archive in memory, this streams it.
   */
  @Test
  fun backsUpSeveralHundredMegabytesWithLittleMemory() {
    val storage = temp.newFolder("big")
    val random = Random(7)
    val chunk = ByteArray(1024 * 1024)
    val entries = mutableListOf<BackupZip.Entry>()
    // 3 large books of 100 MB of images, and 2,000 small chapters.
    for (book in 1..3) {
      val image = File(storage, "novels/$book/images/scan.jpg").also { it.parentFile.mkdirs() }
      FileOutputStream(image).use { out ->
        repeat(100) {
          random.nextBytes(chunk)
          out.write(chunk)
        }
      }
      entries.add(BackupZip.Entry("files/novels/$book/images/scan.jpg", image))
    }
    for (chapter in 1..2000) {
      entries.add(
        BackupZip.Entry(
          "files/novels/1/chapters/$chapter.html",
          file(storage, "novels/1/chapters/$chapter.html", "<p>Chapitre $chapter</p>".repeat(200).toByteArray()),
        ),
      )
    }
    val zip = File(temp.root, "backup.zip")
    var lastProgress: BackupZip.Progress? = null
    val written = FileOutputStream(zip).use { BackupZip.write(it, entries) { progress -> lastProgress = progress } }
    assertEquals(entries.size, written.entries)
    assertTrue("archive of ${zip.length()} bytes", zip.length() > 300L * 1024 * 1024)
    assertEquals(lastProgress!!.totalBytes, lastProgress!!.bytes)

    val read = zip.inputStream().use { BackupZip.read(it, zip.length(), null) }
    assertEquals(entries.size + 1, read.entries.size)
    // Reading as a stream stops before the central directory at the end of the zip.
    assertTrue(read.bytes <= zip.length() && read.bytes > zip.length() - 1024 * 1024)
    val checksums = read.texts[BackupZip.CHECKSUMS]!!
    for (entry in read.entries.filter { it.name != BackupZip.CHECKSUMS }) {
      assertTrue(entry.name, checksums.contains("${BackupZip.jsonString(entry.name)}:{\"size\":${entry.size},\"sha256\":\"${entry.sha256}\"}"))
    }
  }
}
