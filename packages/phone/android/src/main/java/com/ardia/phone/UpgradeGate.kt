package com.ardia.phone

import android.content.Context
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.nio.channels.FileChannel
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import org.json.JSONObject

object UpgradeGate {
    class Pending : IllegalStateException("the upgrade import from the previous app has not finished")

    data class Receipt(val version: Int, val tabs: Int, val archive: Int, val visits: Int, val preferences: Int) {
        fun isValid(): Boolean = version == RECEIPT_VERSION && tabs >= 0 && archive >= 0 && visits >= 0 && preferences >= 0

        fun json(): JSONObject = JSONObject().put("version", version).put("tabs", tabs).put("archive", archive).put("visits", visits).put("preferences", preferences)

        companion object {
            fun of(json: JSONObject?): Receipt? {
                json ?: return null
                val keys = listOf("version", "tabs", "archive", "visits", "preferences")
                if (keys.any { !json.has(it) || json.opt(it) !is Number }) return null
                return Receipt(json.getInt("version"), json.getInt("tabs"), json.getInt("archive"), json.getInt("visits"), json.getInt("preferences")).takeIf { it.isValid() }
            }
        }
    }

    const val MARKER_VERSION = 1
    const val RECEIPT_VERSION = 1
    val SOURCE_FILES = listOf("databases/browser.db", "shared_prefs/ardia.browser.xml", "shared_prefs/ardia.blocking.xml", "shared_prefs/ardia.reader.xml")

    @Volatile
    private var known: Boolean? = null

    private fun app(context: Context): Context = context.applicationContext ?: context

    fun dataDir(context: Context): File = runCatching { app(context).dataDir }.getOrNull() ?: app(context).filesDir.parentFile ?: app(context).filesDir

    fun composeSourceExists(context: Context): Boolean = SOURCE_FILES.any { File(dataDir(context), it).exists() }

    fun pending(context: Context): Boolean = known ?: synchronized(this) {
        known ?: (composeSourceExists(context) && marker(context) == null).also { known = it }
    }

    fun markerFile(context: Context): File = File(File(app(context).noBackupFilesDir, "PhoneSync"), "legacy-import.json")

    fun marker(context: Context): Receipt? = runCatching {
        val file = markerFile(context)
        if (!file.isFile) return null
        val json = JSONObject(file.readText())
        if (json.optInt("version", -1) != MARKER_VERSION) return null
        Receipt.of(json.optJSONObject("receipt"))
    }.getOrNull()

    fun writeMarker(context: Context, receipt: Receipt) {
        if (!receipt.isValid()) throw IllegalArgumentException("the import receipt is not valid")
        val file = markerFile(context)
        val folder = file.parentFile ?: throw IOException("the import marker has no folder")
        if (!folder.isDirectory && !folder.mkdirs()) throw IOException("couldn't make the import marker's folder")
        val staged = File(folder, ".${file.name}.partial")
        val body = JSONObject().put("version", MARKER_VERSION).put("receipt", receipt.json()).put("writtenAt", System.currentTimeMillis())
        FileOutputStream(staged).use { out ->
            out.write(body.toString().toByteArray(Charsets.UTF_8))
            out.fd.sync()
        }
        try {
            Files.move(staged.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } catch (unsupported: AtomicMoveNotSupportedException) {
            Files.move(staged.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING)
        }
        runCatching { FileChannel.open(folder.toPath(), StandardOpenOption.READ).use { it.force(true) } }
        if (marker(context) != receipt) throw IOException("the import marker did not read back")
    }

    fun install(context: Context) {
        val app = app(context)
        PhoneSystemLinks.holdWhile { pending(app) }
    }

    fun open(context: Context) {
        known = null
        if (pending(context)) return
        PhoneSystemLinks.release()
    }

    internal fun forgetForTests() {
        known = null
    }
}
