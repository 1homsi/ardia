package com.ardia.phone

import android.app.Activity
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.view.FrameMetrics
import android.view.Window
import org.json.JSONObject

object LookBudget {
    private const val PREFERENCES = "ardia-look-budget"
    private const val KEY_STATE = "state"
    private const val KEY_FORCED = "forced"

    @Volatile
    private var knownDegraded: Boolean? = null

    private fun preferences(context: Context) = (context.applicationContext ?: context).getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    fun state(context: Context): String? = preferences(context).getString(KEY_STATE, null)

    fun forced(context: Context, lab: Boolean = PhoneLab.isOn): String? = if (lab) preferences(context).getString(KEY_FORCED, null) else null

    fun save(context: Context, state: String) {
        preferences(context).edit().putString(KEY_STATE, state).apply()
        knownDegraded = null
    }

    fun force(context: Context, applied: String?, lab: Boolean = PhoneLab.isOn) {
        check(lab) { "forcing the look budget is a lab switch" }
        preferences(context).edit().apply { if (applied == null) remove(KEY_FORCED) else putString(KEY_FORCED, applied) }.apply()
        knownDegraded = null
    }

    fun appliedFrom(state: String?, forced: String?): Boolean {
        if (forced != null) return forced == "degraded"
        return runCatching { JSONObject(state ?: return false).optString("apply") == "degraded" }.getOrDefault(false)
    }

    fun isDegraded(context: Context): Boolean = knownDegraded ?: appliedFrom(state(context), forced(context)).also { knownDegraded = it }

    fun version(context: Context): String {
        val app = context.applicationContext ?: context
        val info = runCatching { app.packageManager.getPackageInfo(app.packageName, 0) }.getOrNull()
        val code = if (info == null) 0L else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
        val commitId = app.resources.getIdentifier("ardia_build_commit", "string", app.packageName)
        val commit = if (commitId != 0) runCatching { app.getString(commitId) }.getOrNull() else null
        return listOfNotNull(info?.versionName ?: "?", code.toString(), commit?.take(12)).joinToString(" ")
    }

    internal fun forgetForTests() {
        knownDegraded = null
    }
}

internal object FrameSampler {
    data class Sample(val totals: List<Double>, val deadlines: List<Double>, val refreshMillis: Double, val windowMillis: Double, val foreignFrames: Long)

    fun sample(activity: Activity, millis: Long, done: (Sample?) -> Unit) {
        val window: Window = activity.window ?: return done(null)
        val thread = HandlerThread("ardia-frame-sampler").apply { start() }
        val handler = Handler(thread.looper)
        val totals = ArrayList<Double>()
        val deadlines = ArrayList<Double>()
        val refreshRate = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) activity.display?.refreshRate else null) ?: @Suppress("DEPRECATION") activity.windowManager.defaultDisplay.refreshRate
        val interval = 1_000_000_000.0 / refreshRate.coerceAtLeast(1f)
        val listener = Window.OnFrameMetricsAvailableListener { _, metrics, _ ->
            totals += metrics.getMetric(FrameMetrics.TOTAL_DURATION) / 1_000_000.0
            val deadline = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) metrics.getMetric(FrameMetrics.DEADLINE).toDouble() else interval
            deadlines += (if (deadline > 0) deadline else interval) / 1_000_000.0
        }
        val started = SystemClock.uptimeMillis()
        val foreignBefore = LookActivity.foreignTraversals
        window.addOnFrameMetricsAvailableListener(listener, handler)
        Handler(Looper.getMainLooper()).postDelayed({
            runCatching { window.removeOnFrameMetricsAvailableListener(listener) }
            handler.post {
                done(Sample(totals.toList(), deadlines.toList(), interval / 1_000_000.0, (SystemClock.uptimeMillis() - started).toDouble(), LookActivity.foreignTraversals - foreignBefore))
                thread.quitSafely()
            }
        }, millis)
    }
}
