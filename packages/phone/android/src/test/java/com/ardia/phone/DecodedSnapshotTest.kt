package com.ardia.phone

import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import com.facebook.imagepipeline.cache.DefaultCacheKeyFactory
import com.facebook.imagepipeline.common.ResizeOptions
import com.facebook.imagepipeline.request.ImageRequest
import com.facebook.imagepipeline.request.ImageRequestBuilder
import com.facebook.react.modules.fresco.ReactNetworkImageRequest
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DecodedSnapshotTest {
    @Before
    fun reactFlags() = com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests.setUp()

    private fun reactNativeImageKey(uri: String, resize: ResizeOptions?) = DefaultCacheKeyFactory.getInstance().getBitmapCacheKey(
        ReactNetworkImageRequest.fromBuilderWithHeaders(
            ImageRequestBuilder.newBuilderWithSource(Uri.parse(uri))
                .setPostprocessor(null)
                .setResizeOptions(resize)
                .setAutoRotateEnabled(true)
                .setProgressiveRenderingEnabled(false)
                .setLowestPermittedRequestLevel(ImageRequest.RequestLevel.FULL_FETCH),
            null,
        ),
        null,
    )

    @Test
    fun theHeldPictureIsUnderTheKeyReactNativesImageAsksForWithResizeMethodScale() {
        val uri = "file:///data/user/0/com.ardia.browser.android/files/PageSnapshots/tab-1-1731650000000-600x1300.jpg"
        assertEquals(reactNativeImageKey(uri, null), ImageMemory.decodedKey(uri))
        assertNotEquals("resizeMethod auto resizes file:// pictures to the view, which is another key", reactNativeImageKey(uri, ResizeOptions(400, 860)), ImageMemory.decodedKey(uri))
    }

    private fun page(): Bitmap = Bitmap.createBitmap(64, 128, Bitmap.Config.ARGB_8888).apply {
        for (y in 0 until 128) for (x in 0 until 64) setPixel(x, y, if ((x / 8 + y / 8) % 2 == 0) Color.rgb(20 + x, 40 + y, 200) else Color.WHITE)
    }

    @Test
    fun aPictureResolvesBeforeItsFileAndALateWriteNeverRemovesANewerOne() = runBlocking {
        val removed = ArrayList<String>()
        val snapshots = PageSnapshots(RuntimeEnvironment.getApplication()) {
            removed += it.name
            0
        }
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val done = kotlinx.coroutines.CompletableDeferred<Pair<File, Boolean>>()
        val first = snapshots.writeAhead("tab-9", page(), isPrivate = false, quality = 80, scope) { file, ok -> done.complete(file to ok) }!!
        assertEquals(true, first["writing"])
        val (file, ok) = done.await()
        assertTrue(ok)
        assertEquals(File(first["path"] as String), file)
        assertTrue(file.isFile)
        Thread.sleep(2)
        val later = kotlinx.coroutines.CompletableDeferred<Boolean>()
        val second = snapshots.writeAhead("tab-9", page(), isPrivate = false, quality = 80, scope) { _, written -> later.complete(written) }!!
        assertTrue(later.await())
        assertEquals("the newer write removes the older picture", listOf(file.name), removed)
        assertTrue(File(second["path"] as String).isFile)
    }
}
