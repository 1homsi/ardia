package com.ardia.phone

import android.content.Context
import android.graphics.Bitmap
import com.ardia.browser.PageCapture
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class PageSnapshots(context: Context, private val onRemoved: (File) -> Int = { 0 }) {
    private val app = context.applicationContext
    private val saved = File(app.filesDir, SAVED_FOLDER)
    private val private = File(app.cacheDir, PRIVATE_FOLDER)

    suspend fun write(pageId: String, bitmap: Bitmap, isPrivate: Boolean, quality: Int): Map<String, Any?>? = withContext(Dispatchers.IO) {
        val folder = if (isPrivate) private else saved
        if (!folder.isDirectory && !folder.mkdirs()) return@withContext null
        val stem = fileStem(pageId)
        val previous = older(folder, stem, keep = null).maxByOrNull { it.lastModified() }
        if (previous != null && looksBlank(bitmap)) {
            bitmap.recycle()
            return@withContext describe(previous) + ("kept" to true)
        }
        val target = File(folder, "$stem-${System.currentTimeMillis()}-${bitmap.width}x${bitmap.height}.jpg")
        val staging = File(folder, "$stem.partial")
        val written = runCatching {
            staging.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(1, 100), it) }
        }.getOrDefault(false)
        val width = bitmap.width
        val height = bitmap.height
        bitmap.recycle()
        if (!written || !staging.renameTo(target)) {
            staging.delete()
            return@withContext null
        }
        older(folder, stem, keep = target).forEach { remove(it) }
        mapOf("path" to target.absolutePath, "uri" to "file://${target.absolutePath}", "width" to width, "height" to height, "bytes" to target.length().toDouble())
    }

    suspend fun writeAhead(pageId: String, bitmap: Bitmap, isPrivate: Boolean, quality: Int, scope: CoroutineScope, written: (File, Boolean) -> Unit = { _, _ -> }): Map<String, Any?>? = withContext(Dispatchers.IO) {
        val folder = if (isPrivate) private else saved
        if (!folder.isDirectory && !folder.mkdirs()) return@withContext null
        val stem = fileStem(pageId)
        val previous = older(folder, stem, keep = null).maxByOrNull { it.lastModified() }
        if (previous != null && looksBlank(bitmap)) {
            bitmap.recycle()
            return@withContext describe(previous) + ("kept" to true)
        }
        val stamp = System.currentTimeMillis()
        val width = bitmap.width
        val height = bitmap.height
        val target = File(folder, "$stem-$stamp-${width}x$height.jpg")
        scope.launch(Dispatchers.IO) { written(target, finishWrite(folder, stem, stamp, target, bitmap, quality)) }
        mapOf("path" to target.absolutePath, "uri" to "file://${target.absolutePath}", "width" to width, "height" to height, "bytes" to 0.0, "writing" to true)
    }

    private fun finishWrite(folder: File, stem: String, stamp: Long, target: File, bitmap: Bitmap, quality: Int): Boolean {
        val staging = File(folder, "${target.name}.partial")
        val done = runCatching {
            staging.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(1, 100), it) }
        }.getOrDefault(false)
        bitmap.recycle()
        if (!done || !staging.renameTo(target)) {
            staging.delete()
            return false
        }
        older(folder, stem, keep = target).filter { (stampOf(it, stem) ?: Long.MAX_VALUE) < stamp }.forEach { remove(it) }
        return true
    }

    private fun stampOf(file: File, stem: String): Long? = file.name.removePrefix("$stem-").substringBefore('-').toLongOrNull()

    private fun looksBlank(bitmap: Bitmap): Boolean = PageCapture.isBlank(bitmap, blackIsBlank = true) || PageCapture.isNearlyUniform(bitmap)

    private fun describe(file: File): Map<String, Any?> {
        val size = sizeIn.find(file.name)
        return mapOf(
            "path" to file.absolutePath,
            "uri" to "file://${file.absolutePath}",
            "width" to (size?.groupValues?.get(1)?.toIntOrNull() ?: 0),
            "height" to (size?.groupValues?.get(2)?.toIntOrNull() ?: 0),
            "bytes" to file.length().toDouble(),
        )
    }

    data class Removed(val files: Int, val decodedDropped: Int)

    fun delete(pageId: String): Removed {
        val stem = fileStem(pageId)
        val found = listOf(saved, private).flatMap { folder -> older(folder, stem, keep = null).sortedBy { it.lastModified() } }
        return Removed(found.size, found.sumOf(::remove))
    }

    fun files(pageId: String): List<File> {
        val stem = fileStem(pageId)
        return listOf(saved, private).flatMap { folder -> older(folder, stem, keep = null) }
    }

    fun endPrivateBrowsing() {
        private.listFiles()?.forEach { remove(it) }
    }

    private fun remove(file: File): Int {
        file.delete()
        return runCatching { onRemoved(file) }.getOrDefault(0)
    }

    private fun older(folder: File, stem: String, keep: File?): List<File> =
        folder.listFiles { file -> file.name.startsWith("$stem-") && file.name.endsWith(".jpg") && file != keep }?.toList().orEmpty()

    companion object {
        private const val SAVED_FOLDER = "PageSnapshots"
        private const val PRIVATE_FOLDER = "PrivatePageSnapshots"
        private val safeId = Regex("[A-Za-z0-9_]{1,64}")
        private val sizeIn = Regex("-(\\d+)x(\\d+)\\.jpg$")

        fun fileStem(pageId: String): String {
            if (safeId.matches(pageId)) return pageId
            val digest = MessageDigest.getInstance("SHA-256").digest(pageId.toByteArray(Charsets.UTF_8))
            return digest.take(16).joinToString("") { "%02x".format(it) }
        }
    }
}
