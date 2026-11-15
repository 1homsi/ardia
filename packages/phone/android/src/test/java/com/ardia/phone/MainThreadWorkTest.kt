package com.ardia.phone

import org.junit.Assert.assertEquals
import org.junit.Test

class MainThreadWorkTest {
    @Test
    fun everyMainThreadMessageButTheFrameItselfCounts() {
        var now = 0L
        val work = MainThreadWork { now }
        fun message(target: String, lasting: Long) {
            work.println(">>>>> Dispatching to Handler ($target) {1a2b} null: 0")
            now += lasting
            work.println("<<<<< Finished to Handler ($target) {1a2b} null")
        }
        message("android.view.View\$AttachInfo\$InvokeQueue", 3_000_000)
        message("android.view.Choreographer\$FrameHandler) {c} android.view.Choreographer\$FrameDisplayEventReceiver@9", 7_000_000)
        message("android.os.Handler", 2_000_000)
        now += 40_000_000
        message("com.facebook.react.bridge.queue.MessageQueueThreadHandler", 1_500_000)
        assertEquals("the tick, a post and React Native's mount count; the frame and the idle gap don't", 6_500_000L, work.nanos)
    }
}
