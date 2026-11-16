package com.ardia.phone

import android.content.Context
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import com.ardia.browser.Page
import com.ardia.browser.PageColors
import com.ardia.browser.PageState
import com.ardia.browser.ErrorPages
import com.ardia.browser.PageTone
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.roundToInt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

class PageView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private val onPageEvent by EventDispatcher()
    private val host = FrameLayout(context)
    private var scope: CoroutineScope? = null
    private var sampled: PageTone? = null
    private var sentTone: PageTone? = null
    private var toneSampledSinceBind = false
    private var failedId: String? = null

    var pageId: String? = null
    var initialUrl: String? = null
    var title: String? = null
    var isPrivate: Boolean = false
    var savedState: String? = null
    var toneInsets: Pair<Double, Double> = 0.0 to 0.0
    var page: Page? = null
        private set

    private val gestures = PageGestures(this, host)

    var swipeMode: SwipeMode
        get() = gestures.mode
        set(value) {
            gestures.mode = value
        }

    var pullToRefresh: Boolean
        get() = gestures.pullToRefresh
        set(value) {
            gestures.pullToRefresh = value
        }

    var surfaceColor: Int?
        get() = gestures.surfaceColor
        set(value) {
            gestures.surfaceColor = value
        }

    private var drawnAskedAt = 0L

    private val drawn = PageDrawnWatch(
        object : DrawnSurface {
            override fun visible() = isShown && width > 0 && height > 0 && PageDrawnWatch.shownAlpha(this@PageView) > 0f

            override fun postVisualState(done: () -> Unit): Boolean {
                val web = PageDrawnWatch.webViewIn(host) ?: return false
                drawnAskedAt = SystemClock.uptimeMillis()
                web.postVisualStateCallback(
                    drawnAskedAt,
                    object : WebView.VisualStateCallback() {
                        override fun onComplete(requestId: Long) = done()
                    },
                )
                return true
            }

            override fun afterNextFrameCommits(done: () -> Unit) {
                viewTreeObserver.registerFrameCommitCallback { done() }
                (PageDrawnWatch.webViewIn(host) ?: this@PageView).invalidate()
            }
        },
    ) {
        cover.pageDrawn()
        lab { "page view ${page?.id ?: pageId} drawn ${SystemClock.uptimeMillis() - drawnAskedAt} ms after it became visible" }
        onPageEvent(mapOf("name" to "drawn"))
    }

    private val cover = CoverHandOver(
        object : CoverSurface {
            override fun find(nativeId: String): View? = com.facebook.react.uimanager.util.ReactFindViewUtil.findView(rootView, nativeId)

            override fun schedule(millis: Long, run: () -> Unit): () -> Unit {
                val task = Runnable(run)
                postDelayed(task, millis)
                return { removeCallbacks(task) }
            }
        },
    ) { reason, found ->
        lab { "page view ${page?.id ?: pageId} hid its cover on ${if (reason == CoverHandOver.REASON_CAP) "the ${CoverHandOver.CAP_MILLIS} ms cap" else "its first drawn frame"}${if (found) "" else ", but no view had that nativeID"}" }
        onPageEvent(mapOf("name" to "coverHidden", "reason" to reason, "found" to found))
    }

    var coverNativeId: String?
        get() = cover.nativeId
        set(value) = cover.cover(value)

    init {
        drawn.onVisible = { cover.pageVisible() }
        addView(host, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        gestures.install()
    }

    override fun requestDisallowInterceptTouchEvent(disallow: Boolean) {
        super.requestDisallowInterceptTouchEvent(disallow)
        if (disallow) gestures.contentTookTheDrag()
    }

    override fun onInterceptTouchEvent(event: MotionEvent): Boolean = gestures.intercepts(event) || super.onInterceptTouchEvent(event)

    override fun onTouchEvent(event: MotionEvent): Boolean = gestures.touch(event) || super.onTouchEvent(event)

    fun bind() {
        val id = pageId ?: return
        if (page?.id == id || failedId == id) return
        unbind()
        val opened = try {
            PhonePages.open(context, id, PhonePages.setup(initialUrl, title, isPrivate, savedState))
        } catch (error: CodedException) {
            failedId = id
            onPageEvent(mapOf("name" to "error", "code" to error.code, "message" to (error.message ?: error.code)))
            return
        }
        page = opened
        toneSampledSinceBind = false
        gestures.page = opened
        PhonePages.viewShows(id, this)
        val running = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        scope = running
        running.launch { opened.view.collect(::show) }
        running.launch { opened.state.collect(::sendState) }
        running.launch { sampleTone(opened) }
    }

    fun unbind() {
        cover.cancel()
        drawn.reset()
        page?.id?.let { PhonePages.viewLeaves(it, this) }
        scope?.cancel()
        scope = null
        page = null
        gestures.page = null
        gestures.detach()
        failedId = null
        sampled = null
        sentTone = null
        toneSampledSinceBind = false
        host.removeAllViews()
    }

    private val asksWhenShown = android.view.ViewTreeObserver.OnPreDrawListener {
        if (PhonePages.permissionAsks.pending > 0) PhonePages.permissionAsks.pump()
        drawn.frame()
        true
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        page?.id?.let(PhonePages::activate)
        viewTreeObserver.addOnPreDrawListener(asksWhenShown)
    }

    override fun onDetachedFromWindow() {
        viewTreeObserver.removeOnPreDrawListener(asksWhenShown)
        cover.cancel()
        drawn.reset()
        super.onDetachedFromWindow()
    }

    private fun show(view: View?) {
        if (view != null && view.parent === host && host.childCount == 1) return
        val hadView = host.childCount > 0
        host.removeAllViews()
        drawn.reset()
        if (view == null) {
            if (hadView) lab { "page view ${page?.id ?: pageId} lost its WebView (the page released it), ${width}x$height" }
            return
        }
        val owner = view.parent as? ViewGroup
        owner?.removeView(view)
        host.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        layOutChildren()
        lab {
            val from = if (owner != null) ", taken from another view (${owner.javaClass.simpleName}${(owner.parent as? PageView)?.let { " of page view ${it.pageId}" } ?: ""})" else ""
            "page view ${page?.id ?: pageId} shows its WebView at ${width}x$height, ${if (isShown) "shown" else "not shown"}$from"
        }
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        lab { "page view ${page?.id ?: pageId} size ${oldw}x$oldh -> ${w}x$h" }
    }

    private inline fun lab(line: () -> String) {
        if (PhoneLab.isOn) android.util.Log.i("PAGELAB", "PAGELAB ${line()}")
    }

    private val layOutAgain = Runnable { layOutChildren() }

    private fun layOutChildren() {
        if (width == 0 || height == 0) return
        host.measure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY))
        host.layout(0, 0, width, height)
        gestures.layout(width, height)
    }

    override fun requestLayout() {
        super.requestLayout()
        @Suppress("SENSELESS_COMPARISON")
        if (layOutAgain != null) post(layOutAgain)
    }

    private fun sendState(state: PageState) {
        onPageEvent(present(mapOf("name" to "state") + PagePayloads.state(context, state, page?.isPrivate ?: isPrivate)))
        sendTone(state)
    }

    private fun present(fields: Map<String, Any?>): Map<String, Any> = buildMap { fields.forEach { (key, value) -> if (value != null) put(key, value) } }

    private fun sendTone(state: PageState) {
        if (state.failure != null) sampled = null
        if (!PageToneGate.reports(state.themeColor, state.failure != null, toneSampledSinceBind)) return
        val tone = ErrorPages.tone(state.failure, PageTone.resolve(state.themeColor, state.backgroundColor, sampled, stored = null))
        if (tone == sentTone || (tone.top == null && tone.bottom == null && sentTone == null)) return
        sentTone = tone
        onPageEvent(
            buildMap {
                put("name", "tone")
                tone.top?.let { put("top", PageColors.hex(it)) }
                tone.bottom?.let { put("bottom", PageColors.hex(it)) }
            },
        )
    }

    private suspend fun sampleTone(page: Page) {
        page.state.map { Triple(it.isLoading, it.scrollDirection, it.isScrolledToTop) }.distinctUntilChanged().collectLatest { (loading, _, _) ->
            if (loading) return@collectLatest
            delay(TONE_SETTLE_MILLIS)
            val density = resources.displayMetrics.density
            val (top, bottom) = toneInsets
            val taken = page.sampleTone((top * density).roundToInt(), (bottom * density).roundToInt())
            toneSampledSinceBind = true
            if (taken != null) sampled = taken
            sendTone(page.state.value)
        }
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        host.layout(0, 0, r - l, b - t)
        gestures.layout(r - l, b - t)
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        super.onMeasure(widthMeasureSpec, heightMeasureSpec)
        host.measure(
            MeasureSpec.makeMeasureSpec(measuredWidth, MeasureSpec.EXACTLY),
            MeasureSpec.makeMeasureSpec(measuredHeight, MeasureSpec.EXACTLY),
        )
    }

    private companion object {
        const val TONE_SETTLE_MILLIS = 250L
    }
}

internal object PageToneGate {
    fun reports(themeColor: Int?, failed: Boolean, sampledSinceBind: Boolean): Boolean = sampledSinceBind || themeColor != null || failed
}
