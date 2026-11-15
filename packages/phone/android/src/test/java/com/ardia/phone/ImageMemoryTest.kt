package com.ardia.phone

import android.content.ComponentCallbacks2
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ImageMemoryTest {
    @Test
    fun onlyTheRunningTrimsAskForASettleFrameBecauseTheRendererTrimsItselfFromHiddenUp() {
        assertTrue(ImageMemory.settlesAfterTrim(ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW))
        assertTrue(ImageMemory.settlesAfterTrim(ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL))
        assertFalse(ImageMemory.settlesAfterTrim(ComponentCallbacks2.TRIM_MEMORY_RUNNING_MODERATE))
        assertFalse(ImageMemory.settlesAfterTrim(ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN))
        assertFalse(ImageMemory.settlesAfterTrim(ComponentCallbacks2.TRIM_MEMORY_BACKGROUND))
        assertFalse(ImageMemory.settlesAfterTrim(ComponentCallbacks2.TRIM_MEMORY_COMPLETE))
    }

    @Test
    fun theSettleFrameWaitsPastTheRenderersTenSecondMinimumRetention() {
        assertTrue(ImageMemory.SETTLE_AFTER_MILLIS > 10_000L)
    }

    @Test
    fun aCloseSaysWhyItDroppedNothing() {
        assertTrue(ImageMemory.closeSummary(0, 0).startsWith("no snapshot files left"))
        assertEquals("2 snapshot file(s), none decoded in memory", ImageMemory.closeSummary(2, 0))
        assertEquals("2 snapshot file(s), dropped 3 decoded", ImageMemory.closeSummary(2, 3))
    }
}
