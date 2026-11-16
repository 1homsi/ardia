package com.ardia.phone

import android.app.Activity
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.os.SystemClock
import android.view.View
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.lang.ref.WeakReference

class InsetHold(private val clock: () -> Long = SystemClock::uptimeMillis) {
    private var seen: Configuration? = null
    private var last: Insets? = null
    private var held: Insets? = null
    private var beforeFullscreen: Insets? = null
    private var until = 0L
    private var heldSince = -1L
    private var why = ""

    val holding: Boolean get() = clock() < until

    val heldMillisLeft: Long get() = (until - clock()).coerceAtLeast(0)

    fun configurationChanged(next: Configuration) {
        val before = seen
        seen = Configuration(next)
        if (before == null) return
        val diff = before.diff(next)
        val change = "0x${Integer.toHexString(diff)}"
        when {
            diff and LAYOUT_CHANGES != 0 -> {
                if (holding || diff and ActivityInfo.CONFIG_UI_MODE != 0) lab { "inset hold: none, the change $change moves the layout" }
                until = 0
            }
            diff and ActivityInfo.CONFIG_UI_MODE != 0 -> {
                hold(last, HOLD_MILLIS, "a light/dark change ($change)")
            }
            holding -> lab { "inset hold: the change $change leaves the hold on, ${heldMillisLeft} ms left" }
        }
    }

    fun fullscreenStarts() {
        if (last != null && last != Insets.NONE) beforeFullscreen = last
        until = 0
    }

    fun fullscreenEnds() {
        val bars = beforeFullscreen ?: return
        beforeFullscreen = null
        hold(bars, RETURN_MILLIS, "leaving fullscreen")
    }

    private fun hold(value: Insets?, millis: Long, reason: String) {
        if (value == null || value == Insets.NONE) return
        held = value
        until = clock() + millis
        why = reason
        lab { "inset hold: $reason holds the navigation bar's ${value.bottom} px for up to $millis ms" }
    }

    fun navigationBars(raw: Insets): Insets {
        val keep = held
        if (holding && raw == Insets.NONE && keep != null) {
            if (heldSince < 0) heldSince = clock()
            return keep
        }
        if (heldSince >= 0) {
            lab { "inset hold: after $why the navigation bar's ${keep?.bottom} px came back as ${raw.bottom} px after ${clock() - heldSince} ms${if (holding) "" else ", at the deadline"}" }
            heldSince = -1
        }
        if (holding && raw != Insets.NONE) held = raw
        last = raw
        return raw
    }

    fun ime(rawIme: Int, rawNavigation: Insets): Int {
        val keep = held
        if (!holding || rawIme <= 0 || rawNavigation != Insets.NONE || keep == null) return rawIme
        return rawIme + keep.bottom
    }

    private inline fun lab(line: () -> String) {
        if (PhoneLab.isOn) android.util.Log.i("PAGELAB", "PAGELAB ${line()}")
    }

    companion object {
        const val HOLD_MILLIS = 1000L
        const val RETURN_MILLIS = 500L
        private const val LAYOUT_CHANGES = ActivityInfo.CONFIG_ORIENTATION or ActivityInfo.CONFIG_SCREEN_SIZE or ActivityInfo.CONFIG_SMALLEST_SCREEN_SIZE or
            ActivityInfo.CONFIG_SCREEN_LAYOUT or ActivityInfo.CONFIG_DENSITY or ActivityInfo.CONFIG_NAVIGATION or ActivityInfo.CONFIG_KEYBOARD or
            ActivityInfo.CONFIG_KEYBOARD_HIDDEN or ActivityInfo.CONFIG_FONT_SCALE

        val window = InsetHold()
        private var installed = WeakReference<View>(null)

        fun install(activity: Activity) {
            window.configurationChanged(activity.resources.configuration)
            val content = activity.findViewById<View>(android.R.id.content) ?: return
            installed = WeakReference(content)
            val again = Runnable { ViewCompat.requestApplyInsets(content) }
            ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
                val raw = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
                val passed = window.navigationBars(raw)
                view.removeCallbacks(again)
                if (passed == raw) return@setOnApplyWindowInsetsListener insets
                view.postDelayed(again, window.heldMillisLeft + 1)
                WindowInsetsCompat.Builder(insets).setInsets(WindowInsetsCompat.Type.navigationBars(), passed).build()
            }
        }

        fun fullscreenStarts() = window.fullscreenStarts()

        fun fullscreenEnds() {
            window.fullscreenEnds()
            installed.get()?.let(ViewCompat::requestApplyInsets)
        }

        fun navigationBottom(view: View): Int {
            val raw = ViewCompat.getRootWindowInsets(view)?.getInsets(WindowInsetsCompat.Type.navigationBars()) ?: return 0
            return window.navigationBars(raw).bottom
        }

        fun imeBottom(view: View): Int {
            val insets = ViewCompat.getRootWindowInsets(view) ?: return 0
            return window.ime(insets.getInsets(WindowInsetsCompat.Type.ime()).bottom, insets.getInsets(WindowInsetsCompat.Type.navigationBars()))
        }
    }
}
