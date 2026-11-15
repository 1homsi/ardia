package com.ardia.phone

import android.content.Context
import android.view.View
import android.view.ViewTreeObserver
import android.view.inputmethod.InputMethodManager
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

internal class FieldKeyboard(
    private val field: View,
    private val show: (View) -> Unit = ::requestShow,
    private val hide: (View) -> Unit = ::requestHide,
) {
    private var waiting: ViewTreeObserver.OnWindowFocusChangeListener? = null

    val isWaitingForWindowFocus: Boolean get() = waiting != null

    fun open() {
        if (field.hasWindowFocus()) {
            forget()
            show(field)
            return
        }
        if (waiting != null) return
        val listener = object : ViewTreeObserver.OnWindowFocusChangeListener {
            override fun onWindowFocusChanged(hasFocus: Boolean) {
                if (!hasFocus) return
                forget()
                if (field.isFocused) show(field)
            }
        }
        waiting = listener
        field.viewTreeObserver.addOnWindowFocusChangeListener(listener)
    }

    fun close() {
        forget()
        hide(field)
    }

    private fun forget() {
        val listener = waiting ?: return
        waiting = null
        field.viewTreeObserver.takeIf { it.isAlive }?.removeOnWindowFocusChangeListener(listener)
    }

    companion object {
        private fun inputMethods(view: View) = view.context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager

        fun requestShow(view: View) {
            inputMethods(view)?.showSoftInput(view, InputMethodManager.SHOW_IMPLICIT)
        }

        fun requestHide(view: View) {
            inputMethods(view)?.hideSoftInputFromWindow(view.windowToken, 0)
            @Suppress("DEPRECATION")
            ViewCompat.getWindowInsetsController(view)?.hide(WindowInsetsCompat.Type.ime())
        }
    }
}
