package com.ardia.phone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.math.abs

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MotionPlanTest {
    private val depart = MotionCurve.Timing(200, listOf(0.2f, 0f, 0f, 1f))
    private val expand = MotionCurve.Spring(0.18, 1.0)
    private val departed = MotionValues(opacity = 0f, translateY = -120f)

    private class Clock(val durationMillis: Long, val onFrame: (Float) -> Unit, val onEnd: (Boolean) -> Unit) : MotionClock {
        override var fraction = 0f
        var cancelled = false

        override fun cancel() {
            if (cancelled) return
            cancelled = true
            onEnd(false)
        }

        fun at(value: Float) {
            fraction = value
            onFrame(value)
        }

        fun finish() {
            at(1f)
            onEnd(true)
        }
    }

    private class Surface : MotionSurface {
        override var animates = true
        var values = MotionValues()
        var radiusTouched = false
        val renderThread = ArrayList<Pair<Map<MotionChannel, Float>, MotionCurve>>()
        var cancels = 0
        val clocks = ArrayList<Clock>()

        override fun set(values: MotionValues, channels: Set<MotionChannel>) {
            var next = this.values
            for (channel in channels) {
                val value = values.value(channel) ?: continue
                if (channel == MotionChannel.CornerRadius) radiusTouched = true
                next = next.with(channel, value)
            }
            this.values = next
        }

        override fun startRenderThread(targets: Map<MotionChannel, Float>, curve: MotionCurve) {
            renderThread += targets to curve
        }

        override fun cancelRenderThread() {
            cancels += 1
        }

        override fun startClock(durationMillis: Long, onFrame: (Float) -> Unit, onEnd: (Boolean) -> Unit): MotionClock = Clock(durationMillis, onFrame, onEnd).also { clocks += it }
    }

    private val surface = Surface()
    private val ends = ArrayList<Boolean>()
    private val runner = MotionRunner(surface).apply { onEnd = { ends += it } }

    @Test
    fun theFirstValueIsShownWithoutMotionOrAnEnd() {
        runner.show(departed, depart)
        assertTrue(surface.renderThread.isEmpty())
        assertTrue(surface.clocks.isEmpty())
        assertEquals(0f, surface.values.opacity)
        assertEquals(-120f, surface.values.translateY)
        assertTrue(ends.isEmpty())
    }

    @Test
    fun mainsDepartCurveRunsOnTheRenderThreadAndTheEndStateIsKept() {
        runner.show(MotionValues(), depart)
        runner.show(departed, depart)
        val (targets, curve) = surface.renderThread.single()
        assertEquals(mapOf(MotionChannel.Opacity to 0f, MotionChannel.TranslateY to -120f), targets)
        assertEquals("a channel that doesn't change gets no animation", null, targets[MotionChannel.Scale])
        assertEquals(200L, curve.durationMillis)
        assertEquals(listOf(0.2f, 0f, 0f, 1f), (curve as MotionCurve.Timing).controlPoints)
        assertEquals("the render thread starts from where the view is", 1f, surface.values.opacity)
        surface.clocks.single().finish()
        assertEquals("the end state stays once the move ends", 0f, surface.values.opacity)
        assertEquals(-120f, surface.values.translateY)
        assertEquals(listOf(true), ends)
    }

    @Test
    fun anUnnamedCurveIsMainsDefault() {
        assertEquals(listOf(0f, 0f, 0.58f, 1f), MotionCurve.Timing(300, null).controlPoints)
        assertEquals(listOf(0f, 0f, 0.58f, 1f), MotionCurve.Timing(300, listOf(1f, 2f)).controlPoints)
    }

    @Test
    fun mainsSpringTokensBecomeACriticallyDampedSpringThatSettles() {
        val spring = MotionCurve.Spring(0.18, 1.0)
        assertEquals(0.0, spring.progress(0.0), 1e-9)
        var previous = 0.0
        for (step in 1..400) {
            val now = spring.progress(step / 1000.0)
            assertTrue("a critically damped spring never overshoots", now <= 1.0 + 1e-9)
            assertTrue("and never goes back", now + 1e-12 >= previous)
            previous = now
        }
        assertTrue("it settles within 0.1% at its settling time", abs(1 - spring.progress(spring.durationMillis / 1000.0)) <= SpringSolution.SETTLED)
        assertTrue("a critically damped spring settles in about one and a half responses: ${spring.durationMillis} ms", spring.durationMillis in 230L..300L)
        assertEquals(1f, spring.interpolator.getInterpolation(1f))
        val bouncy = MotionCurve.Spring(0.3, 0.5)
        assertTrue("a bouncy spring overshoots", (1..600).any { bouncy.progress(it / 1000.0) > 1.0 })
    }

    @Test
    fun theCardsCornersGrowWithTheSameCurveBesideTheRenderThreadMove() {
        runner.show(MotionValues(scale = 0.8f, cornerRadius = 28f), expand)
        assertEquals(28f, surface.values.cornerRadius)
        runner.show(MotionValues(scale = 1f, cornerRadius = 55f), expand)
        val (targets, _) = surface.renderThread.single()
        assertEquals("the corners can't run on the render thread, so the clock moves them", mapOf(MotionChannel.Scale to 1f), targets)
        val clock = surface.clocks.single()
        assertEquals(expand.durationMillis, clock.durationMillis)
        clock.at(0.5f)
        val half = 28f + (55f - 28f) * expand.interpolator.getInterpolation(0.5f)
        assertEquals(half, surface.values.cornerRadius!!, 0.001f)
        clock.finish()
        assertEquals(55f, surface.values.cornerRadius)
        assertEquals("the end waits for the corners too", listOf(true), ends)
    }

    @Test
    fun leavingOutTheCornersNeverTouchesTheViewsOwn() {
        runner.show(MotionValues(), depart)
        runner.show(departed, depart)
        surface.clocks.single().finish()
        assertTrue(!surface.radiusTouched)
        assertNull(surface.values.cornerRadius)
    }

    @Test
    fun theEndFiresOnceWhenTheMoveHasStopped() {
        runner.show(MotionValues(), depart)
        runner.show(departed, depart)
        assertTrue(ends.isEmpty())
        val clock = surface.clocks.single()
        clock.finish()
        assertEquals(listOf(true), ends)
        clock.onEnd(true)
        assertEquals("a late stop doesn't fire it again", listOf(true), ends)
    }

    @Test
    fun aSupersededMoveReportsNothingAndTheNewOneStartsFromWhereTheViewIs() {
        runner.show(MotionValues(), depart)
        runner.show(departed, depart)
        val old = surface.clocks.single()
        old.at(0.5f)
        val shownAtHalf = 1f + (0f - 1f) * depart.interpolator.getInterpolation(0.5f)
        runner.show(MotionValues(opacity = 1f, translateY = -60f), depart)
        assertTrue("the old clock was stopped", old.cancelled)
        assertEquals(1, surface.cancels)
        assertTrue("the old move's end is never reported", ends.isEmpty())
        assertEquals("the new move starts from the presentation value", shownAtHalf, surface.values.opacity, 0.001f)
        surface.clocks.last().finish()
        assertEquals(listOf(true), ends)
    }

    @Test
    fun withoutMotionTheEndStateLandsAtOnceAndReportsFinished() {
        runner.show(MotionValues(), depart)
        surface.animates = false
        runner.show(departed, depart)
        assertTrue(surface.renderThread.isEmpty())
        assertEquals(0f, surface.values.opacity)
        assertEquals(listOf(true), ends)
    }

    @Test
    fun theSameTargetAgainDoesNothing() {
        runner.show(MotionValues(), depart)
        runner.show(departed, depart)
        val move = runner.move
        runner.show(departed, depart)
        assertEquals(move, runner.move)
        assertTrue(ends.isEmpty())
    }

    @Test
    fun leavingTheWindowMidMoveLandsWhereItWasAndReportsUnfinished() {
        runner.show(MotionValues(), depart)
        runner.show(departed, depart)
        surface.clocks.single().at(0.5f)
        runner.interrupt()
        assertEquals(listOf(false), ends)
        runner.interrupt()
        assertEquals(listOf(false), ends)
    }
}
