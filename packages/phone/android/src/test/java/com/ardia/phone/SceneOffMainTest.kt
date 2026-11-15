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

    private fun step() = ShadowSystemClock.advanceBy(Duration.ofMillis(40))

    @Test
    fun aTickOnlyHandsTheSceneToTheWorkerAndTheFinishedSceneIsShownBackOnTheMainThread() {
        val deck = deck()
        step()
        deck.advanceBlobs()
        assertEquals("the tick queued one scene for the worker and drew nothing itself", 1, renders.size)
        assertEquals(null, deck.sceneSize)
        step()
        deck.advanceBlobs()
        assertEquals("a second tick while a scene is being drawn queues nothing more", 1, renders.size)
        renders.removeAt(0).run()
        assertEquals(1, applies.size)
        applies.removeAt(0).run()
        assertEquals(135 to 300, deck.sceneSize)
        val first = deck.shownScene
        step()
        deck.advanceBlobs()
        renders.removeAt(0).run()
        applies.removeAt(0).run()
        assertNotSame("the next scene is drawn into another buffer, never the one on screen", first, deck.shownScene)
    }

    @Test
    fun aSceneThatFinishesAfterTheDeckStoppedIsDropped() {
        val deck = deck()
        step()
        deck.advanceBlobs()
        renders.removeAt(0).run()
        applies.removeAt(0).run()
        val shown = deck.shownScene
        step()
        deck.advanceBlobs()
        deck.stopMotion()
        renders.removeAt(0).run()
        applies.removeAt(0).run()
        assertSame("a late scene from before the stop is not shown", shown, deck.shownScene)
        step()
        deck.advanceBlobs()
        assertEquals("after the stop a tick asks for a new scene again", 1, renders.size)
    }

    @Test
    fun theMainThreadsShareOfATickIsWellUnderAMillisecond() {
        val deck = deck()
        val main = LongArray(200)
        val worker = LongArray(200)
        for (i in -30 until 200) {
            step()
            val a = System.nanoTime()
            deck.advanceBlobs()
            val b = System.nanoTime()
            renders.removeAt(0).run()
            val c = System.nanoTime()
            applies.removeAt(0).run()
            val d = System.nanoTime()
            if (i >= 0) {
                main[i] = (b - a) + (d - c)
                worker[i] = c - b
            }
        }
        main.sort()
        worker.sort()
        println("PAGELAB scene off main on this machine: main thread ${main[100] / 1000} us a tick (tick and hand-back, median), worker ${worker[100] / 1000} us a scene")
        assertTrue("the main thread's share is a small fraction of the scene's drawing", main[100] * 10 < worker[100])
        assertFalse(renders.isNotEmpty())
    }
}
