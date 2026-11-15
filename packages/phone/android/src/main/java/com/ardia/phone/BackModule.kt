package com.ardia.phone

import androidx.activity.BackEventCompat
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TrayBack(private val report: (String, Map<String, Any?>) -> Unit) : OnBackPressedCallback(false) {
    override fun handleOnBackStarted(backEvent: BackEventCompat) = report(PROGRESS, progress(0f, backEvent))

    override fun handleOnBackProgressed(backEvent: BackEventCompat) = report(PROGRESS, progress(backEvent.progress, backEvent))

    override fun handleOnBackCancelled() = report(CANCEL, emptyMap())

    override fun handleOnBackPressed() = report(COMMIT, emptyMap())

    private fun progress(value: Float, event: BackEventCompat): Map<String, Any?> =
        mapOf("progress" to value.coerceIn(0f, 1f).toDouble(), "edge" to if (event.swipeEdge == BackEventCompat.EDGE_LEFT) "left" else "right")

    companion object {
        const val PROGRESS = "onBackProgress"
        const val CANCEL = "onBackCancel"
        const val COMMIT = "onBackCommit"
    }
}

class BackModule : Module() {
    private var trayBack: TrayBack? = null
    private var attachedTo: ComponentActivity? = null

    private fun ensureCallback(): TrayBack? {
        val activity = appContext.currentActivity as? ComponentActivity ?: return null
        val existing = trayBack
        if (existing != null && attachedTo === activity) return existing
        existing?.remove()
        val made = TrayBack { name, body -> sendEvent(name, body) }
        activity.onBackPressedDispatcher.addCallback(activity, made)
        trayBack = made
        attachedTo = activity
        return made
    }

    override fun definition() = ModuleDefinition {
        Name("ArdiaPhoneBack")

        Events(TrayBack.PROGRESS, TrayBack.CANCEL, TrayBack.COMMIT)

        Function("setTrayBackEnabled") { enabled: Boolean ->
            appContext.currentActivity?.runOnUiThread {
                val callback = if (enabled) ensureCallback() else trayBack
                callback?.isEnabled = enabled
            }
            Unit
        }

        OnActivityDestroys {
            trayBack?.remove()
            trayBack = null
            attachedTo = null
        }
    }
}
