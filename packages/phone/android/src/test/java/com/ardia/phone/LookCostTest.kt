package com.ardia.phone

import android.content.Context
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class LookCostTest {
    private val app: Context = RuntimeEnvironment.getApplication()

    @After
    fun reset() {
        LookSwitch.forgetForTests()
        LookPaint.forgetCaches()
    }

    @Test
    fun theBlobFrameRateIsALabSwitchThatLastsAndDefaultsToEveryFrame() {
        assertEquals(0, LookSwitch.blobFramesPerSecond(app, lab = true))
        LookSwitch.setBlobFramesPerSecond(app, 30, lab = true)
        LookSwitch.forgetForTests()
        assertEquals(30, LookSwitch.blobFramesPerSecond(app, lab = true))
        assertEquals("a store build always draws every frame", 0, LookSwitch.blobFramesPerSecond(app, lab = false))
        assertThrows(IllegalStateException::class.java) { LookSwitch.setBlobFramesPerSecond(app, 20, lab = false) }
        LookSwitch.setBlobFramesPerSecond(app, 0, lab = true)
    }

    @Test
    fun theBlobCentreWithoutAllocatingIsTheComposeFormula() {
        val out = FloatArray(2)
        for (index in 0 until 3) {
            for (angle in listOf(0f, 1.1f, 3.9f)) {
                val (x, y) = LookRules.blobCenter(index, angle, 1080f, 2400f)
                LookRules.blobCenterInto(index, angle, 1080f, 2400f, out)
                assertEquals(x, out[0], 0.001f)
                assertEquals(y, out[1], 0.001f)
            }
        }
    }

    @Test
    fun theGrainPaintIsMadeOncePerDensityAndOpacityAndDroppedOnATrim() {
        val first = LookPaint.grain(2.75f, 0.08f)
        assertSame(first, LookPaint.grain(2.75f, 0.08f))
        assertNotSame(first, LookPaint.grain(2.75f, 0.06f))
        LookPaint.forgetCaches()
        assertNotSame(first, LookPaint.grain(2.75f, 0.08f))
    }

    @Test
    fun aSecondSubmitOfTheSameTextWithinOnePressIsDropped() {
        val first = SubmitOnce.Submit("google.com", 1_000L)
        assertTrue(SubmitOnce.isRepeat(first, "google.com", 1_000L + 120L))
        assertFalse("another text is a new submit", SubmitOnce.isRepeat(first, "github.com", 1_000L + 120L))
        assertFalse("a later press is a new submit", SubmitOnce.isRepeat(first, "google.com", 1_000L + SubmitOnce.WINDOW_MILLIS))
        assertFalse(SubmitOnce.isRepeat(null, "google.com", 1_000L))
    }
}
