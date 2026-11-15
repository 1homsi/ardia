package com.ardia.phone

import android.app.Activity
import android.view.View
import android.widget.EditText
import android.widget.FrameLayout
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
class FieldKeyboardTest {
    private class Field(activity: Activity) : EditText(activity) {
        var windowFocused = false

        override fun hasWindowFocus(): Boolean = windowFocused
    }

    private val activity: Activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    private val field = Field(activity)
    private val shown = ArrayList<View>()
    private val hidden = ArrayList<View>()
    private val other = EditText(activity)
    private val keyboard = FieldKeyboard(field, show = { shown += it }, hide = { hidden += it })

    init {
        activity.setContentView(FrameLayout(activity).apply {
            addView(field)
            addView(other)
        })
        field.requestFocus()
    }

    private fun windowFocus(focused: Boolean) {
        field.windowFocused = focused
        val observer = field.viewTreeObserver
        observer.javaClass.getDeclaredMethod("dispatchOnWindowFocusChange", Boolean::class.javaPrimitiveType).apply { isAccessible = true }.invoke(observer, focused)
    }

    @Test
    fun aFieldWhoseWindowHasFocusAsksForTheKeyboardAtOnce() {
        field.windowFocused = true
        keyboard.open()
        assertEquals(listOf<View>(field), shown)
        assertFalse(keyboard.isWaitingForWindowFocus)
    }

    @Test
    fun atAColdStartTheKeyboardIsAskedForOnlyOnceTheWindowHasFocus() {
        keyboard.open()
        keyboard.open()
        assertTrue("before the window has focus nothing is asked: a keyboard asked for then attaches half-shown", shown.isEmpty())
        assertTrue(keyboard.isWaitingForWindowFocus)
        windowFocus(false)
        assertTrue(shown.isEmpty())
        windowFocus(true)
        assertEquals("asked once, when the window gains focus", listOf<View>(field), shown)
        assertFalse(keyboard.isWaitingForWindowFocus)
        windowFocus(true)
        assertEquals(1, shown.size)
    }

    @Test
    fun closingBeforeTheWindowHasFocusCancelsTheWaitAndStillHidesTheKeyboard() {
        keyboard.open()
        keyboard.close()
        assertFalse(keyboard.isWaitingForWindowFocus)
        assertEquals(listOf<View>(field), hidden)
        windowFocus(true)
        assertTrue("a closed field never asks for the keyboard later", shown.isEmpty())
    }

    @Test
    fun aFieldThatLostFocusWhileWaitingDoesNotAskForTheKeyboard() {
        keyboard.open()
        other.requestFocus()
        windowFocus(true)
        assertTrue(shown.isEmpty())
    }
}
