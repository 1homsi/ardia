package com.ardia.phone

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.PixelCopy

internal object LookProbeText {
    fun hex(pixel: Int): String = "#%06x".format(pixel and 0xFFFFFF)
}

object FrostProbe {
    data class Reading(val meanLuma: Int, val nearBlackShare: Int)

    fun read(pixels: IntArray): Reading {
        if (pixels.isEmpty()) return Reading(0, 100)
        var total = 0L
        var black = 0
        for (pixel in pixels) {
            val luma = (((pixel shr 16) and 0xFF) * 2126 + ((pixel shr 8) and 0xFF) * 7152 + (pixel and 0xFF) * 722) / 10000
            total += luma
            if (luma < 16) black += 1
        }
        return Reading((total / pixels.size).toInt(), black * 100 / pixels.size)
    }

    fun probe(activity: Activity) {
        probeDecks(activity)
        val frosts = FrostSources.frosts().filter { it.isShown && it.width > 0 && it.height > 0 }
        Log.i("PAGELAB", "PAGELAB look frost probe: ${frosts.size} frost(s) on screen, page mode ${FrostSources.pageMode.raw}")
        for (frost in frosts) {
            val location = IntArray(2).also(frost::getLocationInWindow)
            val region = Rect(location[0], location[1], location[0] + frost.width, location[1] + frost.height)
            val bitmap = Bitmap.createBitmap(frost.width, frost.height, Bitmap.Config.ARGB_8888)
            val choice = frost.lastChoice
            val from = FrostSources.find(frost.source)
            val page = from?.holdsPage == true
            val sourceSize = from?.let { "${it.width}x${it.height}" } ?: "missing"
            runCatching {
                PixelCopy.request(activity.window, region, bitmap, { result ->
                    if (result == PixelCopy.SUCCESS) {
                        val pixels = IntArray(bitmap.width * bitmap.height).also { bitmap.getPixels(it, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height) }
                        val reading = read(pixels)
                        Log.i("PAGELAB", "PAGELAB look frost probe ${frost.logLabel}: path ${choice?.path?.name?.lowercase() ?: "none"}, frost ${frost.width}x${frost.height}, source $sourceSize, page $page, mean luma ${reading.meanLuma}, near-black ${reading.nearBlackShare}%")
                    } else {
                        Log.i("PAGELAB", "PAGELAB look frost probe ${frost.logLabel}: copy failed ($result)")
                    }
                    bitmap.recycle()
                }, Handler(Looper.getMainLooper()))
            }.onFailure { Log.i("PAGELAB", "PAGELAB look frost probe: copy refused (${it.javaClass.simpleName})") }
        }
    }

    private fun probeDecks(activity: Activity) {
        val decks = DeckBackdrops.all()
        Log.i("PAGELAB", "PAGELAB look deck probe: ${decks.size} deck backdrop(s) attached, ${decks.count { it.isShown }} shown")
        for (deck in decks) {
            Log.i("PAGELAB", "PAGELAB look deck probe: ${deck.describe()}")
            if (!deck.isShown || deck.width <= 0 || deck.height <= 0) continue
            val location = IntArray(2).also(deck::getLocationInWindow)
            val (blobX, blobY) = deck.firstBlobCentre()
            val points = listOf("centre" to (deck.width / 2 to deck.height / 2), "blob 1" to (blobX.toInt() to blobY.toInt()), "corner" to (2 to 2))
                .filter { (_, point) -> point.first in 0 until deck.width && point.second in 0 until deck.height }
            for ((name, point) in points) {
                val bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
                val x = location[0] + point.first
                val y = location[1] + point.second
                runCatching {
                    PixelCopy.request(activity.window, Rect(x, y, x + 1, y + 1), bitmap, { result ->
                        val shown = if (result == PixelCopy.SUCCESS) LookProbeText.hex(bitmap.getPixel(0, 0)) else "copy failed ($result)"
                        Log.i("PAGELAB", "PAGELAB look deck probe pixel $name at ${point.first},${point.second}: $shown")
                        bitmap.recycle()
                    }, Handler(Looper.getMainLooper()))
                }.onFailure { Log.i("PAGELAB", "PAGELAB look deck probe: copy refused (${it.javaClass.simpleName})") }
            }
        }
    }
}
