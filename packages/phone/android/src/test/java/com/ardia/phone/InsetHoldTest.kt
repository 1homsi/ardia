package com.ardia.phone

import android.app.Activity
import android.content.res.Configuration
import android.view.View
import android.widget.FrameLayout
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class InsetHoldTest {
    private var now = 10_000L
    private val hold = InsetHold { now }
    private val threeButton = Insets.of(0, 0, 0, 130)
    private val gestures = Insets.of(0, 0, 0, 44)
    private val gone = Insets.NONE

    private fun config(night: Boolean = false, landscape: Boolean = false, width: Int = 392, height: Int = 872) = Configuration().apply {
        uiMode = Configuration.UI_MODE_TYPE_NORMAL or if (night) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO
        orientation = if (landscape) Configuration.ORIENTATION_LANDSCAPE else Configuration.ORIENTATION_PORTRAIT
        screenWidthDp = width
        screenHeightDp = height
        smallestScreenWidthDp = minOf(width, height)
        densityDpi = 440
        fontScale = 1f
    }

    private fun settled() {
        hold.configurationChanged(config())
        assertEquals(threeButton, hold.navigationBars(threeButton))
    }

    @Test
    fun aLightDarkSwitchHoldsTheNavigationBarThatBrieflyDropsToZero() {
        settled()
        hold.configurationChanged(config(night = true))
        now += 150
        assertEquals("the F4 drops 130 px to 0 for about 330 ms while it rebuilds its navigation bar", threeButton, hold.navigationBars(gone))
        now += 300
        assertEquals(threeButton, hold.navigationBars(threeButton))
        assertTrue(hold.holding)
    }

    @Test
    fun afterTheDeadlineWhateverTheSystemSaysWins() {
        settled()
        hold.configurationChanged(config(night = true))
        now += 200
        assertEquals(threeButton, hold.navigationBars(gone))
        assertEquals(InsetHold.HOLD_MILLIS - 200, hold.heldMillisLeft)
        now += InsetHold.HOLD_MILLIS
        assertFalse(hold.holding)
        assertEquals(gone, hold.navigationBars(gone))
        assertEquals(gone, hold.navigationBars(gone))
    }

    @Test
    fun withoutAConfigurationChangeAZeroGetsThroughAtOnce() {
        settled()
        assertEquals("zero looking wrong is not a reason to hold it", gone, hold.navigationBars(gone))
    }

    @Test
    fun rotationGetsThroughAtOnceEvenWhenTheNightModeChangesWithIt() {
        settled()
        hold.configurationChanged(config(night = true, landscape = true, width = 872, height = 392))
        assertFalse(hold.holding)
        assertEquals(gone, hold.navigationBars(gone))
    }

    @Test
    fun splitScreenGetsThroughAtOnce() {
        settled()
        hold.configurationChanged(config(height = 420))
        assertFalse(hold.holding)
        assertEquals(gone, hold.navigationBars(gone))
    }

    @Test
    fun switchingToGestureNavigationDuringTheHoldGetsThroughAtOnce() {
        settled()
        hold.configurationChanged(config(night = true))
        assertEquals("only a drop to zero is held; a new size is real", gestures, hold.navigationBars(gestures))
        assertEquals(gestures, hold.navigationBars(gone))
    }

    @Test
    fun fullscreenVideoReleasesTheHoldSoItsHiddenBarsGetThrough() {
        settled()
        hold.configurationChanged(config(night = true))
        hold.release()
        assertEquals(gone, hold.navigationBars(gone))
    }

    @Test
    fun theKeyboardIsNotTouched() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val content = activity.findViewById<View>(android.R.id.content)
        val child = FrameLayout(activity)
        var seen: WindowInsetsCompat? = null
        ViewCompat.setOnApplyWindowInsetsListener(child) { _, insets ->
            seen = insets
            insets
        }
        (content as FrameLayout).addView(child)
        InsetHold.install(activity)
        InsetHold.window.navigationBars(threeButton)
        InsetHold.window.configurationChanged(Configuration(activity.resources.configuration).apply { uiMode = uiMode xor Configuration.UI_MODE_NIGHT_MASK })
        val keyboard = Insets.of(0, 0, 0, 900)
        val dispatched = WindowInsetsCompat.Builder().setInsets(WindowInsetsCompat.Type.navigationBars(), gone).setInsets(WindowInsetsCompat.Type.ime(), keyboard).build()
        ViewCompat.dispatchApplyWindowInsets(content, dispatched)
        assertEquals("the React root is handed the held navigation bar", threeButton, seen!!.getInsets(WindowInsetsCompat.Type.navigationBars()))
        assertEquals("and the keyboard as the system reports it", keyboard, seen!!.getInsets(WindowInsetsCompat.Type.ime()))
        InsetHold.window.release()
    }
}
