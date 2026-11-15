package com.ardia.phone

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.io.File

object JsProfiler {
    const val ACTION = "com.ardia.phone.JS_PROFILE"

    private var running: File? = null

    @JvmStatic
    private external fun nativeStart(hz: Double): Boolean

    @JvmStatic
    private external fun nativeStop(path: String): Boolean

    fun profile(context: Context, seconds: Int, hz: Double) {
        if (!PhoneLab.isOn) return
        if (running != null) {
            Log.i("PAGELAB", "PAGELAB js profile: one is already running")
            return
        }
        val folder = context.getExternalFilesDir(null) ?: context.filesDir
        val file = File(folder, "js-profile-${System.currentTimeMillis()}.cpuprofile")
        val started = runCatching {
            System.loadLibrary("ardiahermes")
            nativeStart(hz)
        }.getOrElse { failure ->
            Log.i("PAGELAB", "PAGELAB js profile: Hermes' sampling profiler would not start (${failure.javaClass.simpleName}: ${failure.message})")
            return
        }
        if (!started) {
            Log.i("PAGELAB", "PAGELAB js profile: no Hermes root API in this process")
            return
        }
        running = file
        Log.i("PAGELAB", "PAGELAB js profile: sampling all Hermes runtimes at $hz Hz for $seconds s")
        Handler(Looper.getMainLooper()).postDelayed({
            running = null
            val stopped = runCatching { nativeStop(file.absolutePath) }.getOrDefault(false)
            Log.i("PAGELAB", if (stopped) "PAGELAB js profile: wrote ${file.absolutePath} (${file.length()} bytes)" else "PAGELAB js profile: the dump failed")
        }, seconds * 1000L)
    }
}
