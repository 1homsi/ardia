package com.ardia.phone

import android.app.Activity
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.os.SystemClock
import android.view.View
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class InsetHold(private val clock: () -> Long = SystemClock::uptimeMillis) {
    private var seen: Configuration? = null
    private var last: Insets? = null
    private var until = 0L
    private var heldSince = -1L

    val holding: Boolean get() = clock() < until

    val heldMillisLeft: Long get() = (until - clock()).coerceAtLeast(0)

    fun configurationChanged(next: Configuration) {
        val before = seen
        seen = Configuration(next)
        if (before == null) return
        val diff = before.diff(next)
        if (diff and ActivityInfo.CONFIG_UI_MODE == 0 || diff and LAYOUT_CHANGES != 0) {
            if (diff and ActivityInfo.CONFIG_UI_MODE != 0) lab { "inset hold: no hold, the change 0x${Integer.toHexString(diff)} also moves the layout" }
            until = 0
            return
        }
        until = clock() + HOLD_MILLIS
        lab { "inset hold: a light/dark change (0x${Integer.toHexString(diff)}) holds the navigation bar's ${last?.bottom} px for up to $HOLD_MILLIS ms" }
    }

    fun release() {
        until = 0
    }

    fun navigationBars(raw: Insets): Insets {
        val shown = last
        if (holding && raw == Insets.NONE && shown != null && shown != Insets.NONE) {
            if (heldSince < 0) heldSince = clock()
            return shown
        }
        if (heldSince >= 0) {
            lab { "inset hold: the navigation bar's ${shown?.bottom} px came back as ${raw.bottom} px after ${clock() - heldSince} ms${if (holding) "" else ", at the deadline"}" }
            heldSince = -1
        }
        last = raw
        return raw
    }

    private inline fun lab(line: () -> String) {
        if (PhoneLab.isOn) android.util.Log.i("PAGELAB", "PAGELAB ${line()}")
    }

    companion object {
        const val HOLD_MILLIS = 1000L
        private const val LAYOUT_CHANGES = ActivityInfo.CONFIG_ORIENTATION or ActivityInfo.CONFIG_SCREEN_SIZE or ActivityInfo.CONFIG_SMALLEST_SCREEN_SIZE or
            ActivityInfo.CONFIG_SCREEN_LAYOUT or ActivityInfo.CONFIG_DENSITY or ActivityInfo.CONFIG_NAVIGATION or ActivityInfo.CONFIG_KEYBOARD or
            ActivityInfo.CONFIG_KEYBOARD_HIDDEN or ActivityInfo.CONFIG_FONT_SCALE

        val window = InsetHold()

        fun install(activity: Activity) {
            window.configurationChanged(activity.resources.configuration)
            val content = activity.findViewById<View>(android.R.id.content) ?: return
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

        fun navigationBottom(view: View): Int {
            val raw = ViewCompat.getRootWindowInsets(view)?.getInsets(WindowInsetsCompat.Type.navigationBars()) ?: return 0
            return window.navigationBars(raw).bottom
        }
    }
}
