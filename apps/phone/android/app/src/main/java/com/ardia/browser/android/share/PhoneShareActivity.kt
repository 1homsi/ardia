package com.ardia.browser.android.share

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.remember
import com.ardia.phone.PhoneBrowsingSource
import com.ardia.browser.android.MainActivity
import com.ardia.browser.android.system.SystemDevice
import com.ardia.browser.android.system.SystemStore
import com.ardia.design.ArdiaTheme
import com.ardia.phone.PhoneSync
import com.ardia.sync.SyncPhase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull

class PhoneShareActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val page = sharedPage(intent)
        val snapshot = SystemStore.shared(this).loadSnapshot()
        val app = applicationContext
        setContent {
            val model = remember {
                ShareSheetModel(
                    page = page,
                    snapshot = snapshot,
                    scope = PhoneShare.scope,
                    open = ::openInMain,
                    send = { shared, device -> PhoneShare.send(app, shared, device) },
                    finish = ::finish,
                    cancel = ::finish,
                )
            }
            ArdiaTheme(darkTheme = isSystemInDarkTheme(), look = snapshot.look) {
                ShareSheetView(model)
            }
        }
    }

    private fun openInMain(link: String): Boolean = try {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(link), this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (missing: ActivityNotFoundException) {
        false
    }

    companion object {
        fun sharedPage(intent: Intent?): SharedPage {
            val text = intent?.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
            val subject = intent?.getStringExtra(Intent.EXTRA_SUBJECT) ?: intent?.getStringExtra(Intent.EXTRA_TITLE)
            return SharedPage.from(text, subject)
        }
    }
}

object PhoneShare {
    const val SYNC_WAIT_MILLIS = 20_000L
    private const val POLL_MILLIS = 250L

    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    suspend fun send(context: Context, page: SharedPage, device: SystemDevice): Boolean {
        val url = page.url ?: return false
        if (!PhoneBrowsingSource.isSyncable(url)) return false
        val sync = runCatching { PhoneSync.controller(context, demo = false) }.getOrNull() ?: return false
        val target = withTimeoutOrNull(SYNC_WAIT_MILLIS) {
            while (sync.state.value.isEnabled && sync.state.value.phase != SyncPhase.Updated && sync.snapshot.value.devices.none { it.id == device.id }) delay(POLL_MILLIS)
            sync.snapshot.value.devices.firstOrNull { it.id == device.id }
        } ?: return false
        if (!sync.state.value.isEnabled) return false
        return runCatching { sync.send(url, page.displayTitle, target) }.getOrDefault(false)
    }
}
