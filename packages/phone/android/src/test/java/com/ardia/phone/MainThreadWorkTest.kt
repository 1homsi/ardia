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

    @Test
    fun theWorkIsCountedByMessageAndTheThreeLongestAreNamedByTargetAndCallback() {
        var now = 0L
        val work = MainThreadWork { now }
        fun message(line: String, lasting: Long) {
            work.println(line)
            now += lasting
            work.println("<<<<< Finished to " + line.removePrefix(">>>>> Dispatching to "))
        }
        message(">>>>> Dispatching to Handler (android.view.ViewRootImpl\$ViewRootHandler) {4a1} com.ardia.phone.DeckBackdropView\$\$ExternalSyntheticLambda3@9f2: 0", 400_000)
        message(">>>>> Dispatching to Handler (com.facebook.react.bridge.queue.MessageQueueThreadHandler) {77c} null: 0", 6_200_000)
        message(">>>>> Dispatching to Handler (android.os.Handler) {12} android.widget.Editor\$Blink@3b: 0", 900_000)
        message(">>>>> Dispatching to Handler (android.view.Choreographer\$FrameHandler) {c} android.view.Choreographer\$FrameDisplayEventReceiver@9: 0", 9_000_000)
        message(">>>>> Dispatching to Handler (android.os.Handler) {12} com.ardia.phone.SceneWork\$Companion\$background\$1\$toMain\$1@5: 0", 100_000)
        assertEquals("the frame is not one of the counted messages", 4L, work.messages)
        assertEquals(7_600_000L, work.nanos)
        assertEquals(
            listOf("MessageQueueThreadHandler what 0", "Handler Editor\$Blink", "ViewRootImpl\$ViewRootHandler DeckBackdropView\$\$ExternalSyntheticLambda3"),
            work.longestMessages.map { it.name },
        )
        assertEquals(listOf(6_200_000L, 900_000L, 400_000L), work.longestMessages.map { it.nanos })
    }
}
