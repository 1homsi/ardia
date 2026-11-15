package com.ardia.phone

import android.app.Activity
import android.graphics.Color
import android.widget.FrameLayout
import android.widget.TextView
import expo.modules.kotlin.AppContext
import org.junit.After
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
class FrostTintTest {
    private val activity: Activity = Robolectric.buildActivity(Activity::class.java).setup().get()

    private val appContext: AppContext = run {
        val unsafe = Class.forName("sun.misc.Unsafe").getDeclaredField("theUnsafe").apply { isAccessible = true }.get(null)
        unsafe.javaClass.getMethod("allocateInstance", Class::class.java).invoke(unsafe, AppContext::class.java) as AppContext
    }

    @After
    fun reset() = LookSwitch.forgetForTests()

    @Test
    fun aTintedFillIsTheBackdropColourDesaturatedAsTheBlurWouldBeWithTheTintOverIt() {
        val clear = Color.argb(0, 0, 0, 0)
        assertEquals(Color.rgb(200, 100, 50), FrostTint.frosted(Color.rgb(200, 100, 50), 1f, clear))
        val grey = FrostTint.frosted(Color.rgb(200, 100, 50), 0f, clear)
        assertEquals(Color.red(grey), Color.green(grey))
        val half = FrostTint.frosted(Color.rgb(0, 0, 0), 1f, Color.argb(128, 255, 255, 255))
        assertEquals(128f, Color.red(half).toFloat(), 1f)
    }

    @Test
    fun aSourceHoldingOnlyTheBackdropIsKnownAndOneWithCardsIsNot() {
        val deckSource = FrostSourceView(activity, appContext).apply { addView(DeckBackdropView(activity, appContext)) }
        assertTrue(FrostTint.onlyBackdrop(deckSource))
        val wrapped = FrostSourceView(activity, appContext).apply { addView(FrameLayout(activity).apply { addView(DeckBackdropView(activity, appContext)) }) }
        assertTrue("a plain wrapper around the backdrop still counts", FrostTint.onlyBackdrop(wrapped))
        val withCards = FrostSourceView(activity, appContext).apply {
            addView(DeckBackdropView(activity, appContext))
            addView(TextView(activity))
        }
        assertFalse(FrostTint.onlyBackdrop(withCards))
        assertFalse("an empty source is not a backdrop", FrostTint.onlyBackdrop(FrostSourceView(activity, appContext)))
    }

    @Test
    fun aFrostOverTheBackdropAloneIsTintedAndNeedsNoRecordingUnlessTheLabAsksForBlur() {
        val tinted = FrostPage.choose(blurSupported = true, reduceTransparency = false, hasSource = true, sourceHasContent = true, hardware = true, insideSource = false, holdsPage = false, pageMode = FrostSources.PageMode.Solid, onlyBackdropUnder = true)
        assertEquals(FrostPage.Path.Tinted, tinted.path)
        val belowAndroid12 = FrostPage.choose(blurSupported = false, reduceTransparency = false, hasSource = true, sourceHasContent = false, hardware = true, insideSource = false, holdsPage = false, pageMode = FrostSources.PageMode.Solid, onlyBackdropUnder = true)
        assertEquals("the fill needs no blur, so older phones get it too", FrostPage.Path.Tinted, belowAndroid12.path)
        val asked = FrostPage.choose(blurSupported = true, reduceTransparency = false, hasSource = true, sourceHasContent = true, hardware = true, insideSource = false, holdsPage = false, pageMode = FrostSources.PageMode.Solid, onlyBackdropUnder = true, blurOverBackdrop = true)
        assertEquals(FrostPage.Path.Live, asked.path)
        val reduced = FrostPage.choose(blurSupported = true, reduceTransparency = true, hasSource = true, sourceHasContent = true, hardware = true, insideSource = false, holdsPage = false, pageMode = FrostSources.PageMode.Solid, onlyBackdropUnder = true)
        assertEquals("Reduce Transparency still wins: a plain fill", FrostPage.Path.Fallback, reduced.path)
        val degraded = FrostPage.choose(blurSupported = true, reduceTransparency = false, budgetDegraded = true, hasSource = true, sourceHasContent = true, hardware = true, insideSource = false, holdsPage = false, pageMode = FrostSources.PageMode.Solid, onlyBackdropUnder = true)
        assertEquals(FrostPage.Path.Fallback, degraded.path)
    }

    @Test
    fun theLabSwitchForBlurOverTheBackdropIsLabOnlyAndOffByDefault() {
        assertFalse(LookSwitch.blurOverBackdrop(activity, lab = true))
        LookSwitch.setBlurOverBackdrop(activity, true, lab = true)
        LookSwitch.forgetForTests()
        assertTrue(LookSwitch.blurOverBackdrop(activity, lab = true))
        assertFalse(LookSwitch.blurOverBackdrop(activity, lab = false))
        LookSwitch.setBlurOverBackdrop(activity, false, lab = true)
    }
}
