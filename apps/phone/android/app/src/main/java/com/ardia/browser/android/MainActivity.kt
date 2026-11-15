package com.ardia.browser.android

import android.content.Intent
import android.os.Build
import android.os.Bundle
import com.ardia.phone.FirstScreenDrawn
import com.ardia.phone.PhoneSystemLinks
import com.ardia.phone.ReactBack
import com.ardia.phone.RestorableState
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
    @Suppress("DEPRECATION")
    private val reactBack = ReactBack { onBackPressed() }

    override fun onCreate(savedInstanceState: Bundle?) {
        RestorableState.restore(savedInstanceState)
        super.onCreate(null)
        onBackPressedDispatcher.addCallback(this, reactBack)
        FirstScreenDrawn.watch(this)
        PhoneSystemLinks.activityStarted(intent, restored = savedInstanceState != null)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        RestorableState.save(outState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        PhoneSystemLinks.receive(intent)
    }

    override fun getMainComponentName(): String = "main"

    override fun createReactActivityDelegate(): ReactActivityDelegate = ReactActivityDelegateWrapper(
        this,
        BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
        object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {},
    )

    override fun invokeDefaultOnBackPressed() {
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R && moveTaskToBack(false)) return
        reactBack.bypassed { super.invokeDefaultOnBackPressed() }
    }
}
