package com.ardia.phone

import android.app.Activity
import android.view.View
import android.widget.FrameLayout
import expo.modules.kotlin.AppContext
import java.time.Duration
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowSystemClock

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class SceneOffMainTest {
    private val renders = ArrayList<Runnable>()
    private val applies = ArrayList<Runnable>()

    @org.junit.Before
    fun deferred() {
        com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests.setUp()
        SceneWork.current = object : SceneWork {
            override fun render(job: Runnable) {
                renders += job
            }

            override fun toMain(job: Runnable) {
                applies += job
            }
        }
    }

    @org.junit.After
    fun background() {
        SceneWork.current = SceneWork.background
    }

    private fun deck(): DeckBackdropView {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val unsafe = Class.forName("sun.misc.Unsafe").getDeclaredField("theUnsafe").apply { isAccessible = true }.get(null)
        val app = unsafe.javaClass.getMethod("allocateInstance", Class::class.java).invoke(unsafe, AppContext::class.java) as AppContext
        val root = FrameLayout(activity)
        val deck = DeckBackdropView(activity, app).apply { color = "#B04A7A" }
        root.addView(deck, FrameLayout.LayoutParams(1080, 2400))
        activity.setContentView(root)
        root.measure(View.MeasureSpec.makeMeasureSpec(1080, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(2400, View.MeasureSpec.EXACTLY))
        root.layout(0, 0, 1080, 2400)
        return deck
    }

    private fun step(millis: Long = LookRules.FADE_FRAME_MILLIS) = ShadowSystemClock.advanceBy(Duration.ofMillis(millis))

    private fun finishScenes() {
        while (renders.isNotEmpty()) {
            renders.removeAt(0).run()
            while (applies.isNotEmpty()) applies.removeAt(0).run()
        }
    }

    @Test
    fun theFirstTickShowsASceneAtOnceAndAsksTheWorkerForTheNextOneAFadeAhead() {
        val deck = deck()
        step()
        deck.advanceBlobs()
        assertEquals("the deck opens with a scene already drawn", 135 to 300, deck.sceneSize)
        assertEquals("and one more scene asked of the worker", 1, renders.size)
        step()
        deck.advanceBlobs()
        assertEquals("a tick while that scene is being drawn asks for nothing more", 1, renders.size)
        finishScenes()
        val (from, to) = deck.fadeScenes
        assertTrue(from != null && to != null)
        assertNotSame("the next scene is drawn into another buffer, never the one on screen", from, to)
    }

    @Test
    fun aSceneIsDrawnEveryFourHundredMillisecondsAndTheFramesBetweenCrossFade() {
        val deck = deck()
        step()
        deck.advanceBlobs()
        finishScenes()
        var asked = 0
        repeat(20) {
            step()
            deck.advanceBlobs()
            asked += renders.size
            finishScenes()
        }
        assertEquals("two seconds of frames at 100 ms ask for five scenes, not twenty", 5, asked)
        val (from, to) = deck.fadeScenes
        assertTrue(from != null && to != null)
    }

    @Test
    fun theCrossFadeGoesFromTheOlderSceneToTheNewerOneAcrossItsInterval() {
        val deck = deck()
        step()
        deck.advanceBlobs()
        finishScenes()
        val start = deck.clockForTests()
        assertEquals(0f, deck.fadeShare(start), 0.001f)
        assertEquals(0.5f, deck.fadeShare(start + LookRules.FADE_SCENE_MILLIS / 2), 0.001f)
        assertEquals(1f, deck.fadeShare(start + LookRules.FADE_SCENE_MILLIS), 0.001f)
    }

    @Test
    fun aSceneThatFinishesAfterTheDeckStoppedIsDropped() {
        val deck = deck()
        step()
        deck.advanceBlobs()
        deck.stopMotion()
        finishScenes()
        assertEquals("the scene asked before the stop is not taken", null, deck.fadeScenes.second)
        step()
        deck.advanceBlobs()
        assertEquals("after the stop a tick asks for a scene again", 1, renders.size)
    }

    @Test
    fun theMainThreadsShareOfATickIsWellUnderAMillisecond() {
        val deck = deck()
        val main = ArrayList<Long>()
        val worker = ArrayList<Long>()
        step()
        deck.advanceBlobs()
        finishScenes()
        for (i in 0 until 400) {
            step()
            val a = System.nanoTime()
            deck.advanceBlobs()
            val b = System.nanoTime()
            if (renders.isEmpty()) {
                main += b - a
                continue
            }
            renders.removeAt(0).run()
            val c = System.nanoTime()
            val handBack = System.nanoTime().also { while (applies.isNotEmpty()) applies.removeAt(0).run() }
            val d = System.nanoTime()
            main += (b - a) + (d - handBack)
            worker += c - b
        }
        main.sort()
        worker.sort()
        println("PAGELAB scene off main on this machine: main thread ${main[main.size / 2] / 1000} us a tick (median), worker ${worker[worker.size / 2] / 1000} us a scene, ${worker.size} scenes for ${main.size} frames")
        assertTrue("the main thread's share is a small fraction of a scene's drawing", main[main.size / 2] * 10 < worker[worker.size / 2])
    }

    private fun meanDifference(a: android.graphics.Bitmap, b: android.graphics.Bitmap): Double {
        val left = a.copy(android.graphics.Bitmap.Config.ARGB_8888, false)
        val right = b.copy(android.graphics.Bitmap.Config.ARGB_8888, false)
        var total = 0L
        for (y in 0 until left.height) for (x in 0 until left.width) {
            val p = left.getPixel(x, y)
            val q = right.getPixel(x, y)
            total += kotlin.math.abs(android.graphics.Color.red(p) - android.graphics.Color.red(q)) + kotlin.math.abs(android.graphics.Color.green(p) - android.graphics.Color.green(q)) + kotlin.math.abs(android.graphics.Color.blue(p) - android.graphics.Color.blue(q))
        }
        return total.toDouble() / (left.width * left.height * 3)
    }

    @Test
    fun aCrossFadeMidwayIsCloserToTheTrueSceneThanOneOldFrameStepMovesIt() {
        val deck = deck()
        val start = 12_345L
        val pace = LookRules.blobPaceMillis(1080f, 2400f)
        val from = deck.sceneForTests(start)!!
        val to = deck.sceneForTests(start + LookRules.FADE_SCENE_MILLIS)!!
        val truth = deck.sceneForTests(start + LookRules.FADE_SCENE_MILLIS / 2)!!
        val blend = android.graphics.Bitmap.createBitmap(from.width, from.height, android.graphics.Bitmap.Config.RGBA_F16)
        android.graphics.Canvas(blend).apply {
            drawBitmap(from, 0f, 0f, null)
            drawBitmap(to, 0f, 0f, android.graphics.Paint().apply { alpha = 128 })
        }
        val fadeError = meanDifference(blend, truth)
        val oldStep = meanDifference(deck.sceneForTests(start + LookRules.FADE_SCENE_MILLIS / 2 + pace)!!, truth)
        println("PAGELAB cross-fade check: midway blend against the true scene ${"%.3f".format(fadeError)} of 255 a channel; one old frame step (${pace} ms) changes it by ${"%.3f".format(oldStep)}")
        assertTrue("the fade's error is smaller than what one frame of the old stepping changed", fadeError < oldStep)
    }
}
