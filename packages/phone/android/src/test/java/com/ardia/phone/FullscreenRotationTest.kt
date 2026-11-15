package com.ardia.phone

import android.app.Activity
import android.content.pm.ActivityInfo
import android.view.View
import com.ardia.browser.FullscreenVideo
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class FullscreenRotationTest {
    @Test
    fun aFullscreenVideoFollowsTheUsersRotationAndTheAppGoesBackToPortraitAfter() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        val host = FullscreenHost()
        val video = FullscreenVideo(View(activity)) {}
        host.show(activity, video)
        assertEquals("the video rotates as the Compose app does, within the user's rotation lock", ActivityInfo.SCREEN_ORIENTATION_FULL_USER, activity.requestedOrientation)
        host.hide()
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT, activity.requestedOrientation)
        assertEquals("a stale hold never leaves the app free to rotate", ActivityInfo.SCREEN_ORIENTATION_PORTRAIT, FullscreenRotation.afterward(ActivityInfo.SCREEN_ORIENTATION_FULL_USER))
    }
}
