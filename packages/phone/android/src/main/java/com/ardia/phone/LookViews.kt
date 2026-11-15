package com.ardia.phone

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.BlendMode
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.graphics.Shader
import android.os.Build
import android.os.SystemClock
import android.view.View
import android.view.ViewTreeObserver
import androidx.compose.ui.graphics.toArgb
import com.ardia.design.DeckBackdropStyle
import com.ardia.design.DeckMesh
import com.ardia.design.Frosting
import com.ardia.design.GrainTexture
import com.ardia.design.ProfileBackdropStyle
import com.ardia.design.ProfileLook
import com.ardia.design.SystemPalette
import com.ardia.design.TabsBackdropMotion
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import java.lang.ref.WeakReference
import kotlin.math.PI
import kotlin.math.ceil

internal object LookPaint {
    private val grainBitmap: Bitmap by lazy {
        val pixels = GrainTexture.values().map { value -> (0xFF shl 24) or (value shl 16) or (value shl 8) or value }.toIntArray()
        Bitmap.createBitmap(pixels, GrainTexture.SIDE, GrainTexture.SIDE, Bitmap.Config.ARGB_8888)
    }

    private val meshes = object : LinkedHashMap<Pair<ProfileLook, Boolean>, Bitmap>(8, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Pair<ProfileLook, Boolean>, Bitmap>?): Boolean = size > 12
    }

    private val grains = HashMap<Long, Paint>()

    fun grain(density: Float, opacity: Float): Paint {
        val alpha = (opacity.coerceIn(0f, 1f) * 255f).toInt()
        val key = (density.toRawBits().toLong() shl 32) or alpha.toLong()
        return grains.getOrPut(key) {
            Paint().apply {
                shader = BitmapShader(grainBitmap, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT).apply {
                    setLocalMatrix(Matrix().apply { setScale(density / 2f, density / 2f) })
                }
                blendMode = BlendMode.OVERLAY
                this.alpha = alpha
            }
        }
    }

    fun forgetCaches() {
        synchronized(meshes) { meshes.clear() }
        grains.clear()
    }

    fun mesh(look: ProfileLook, dark: Boolean): Bitmap = synchronized(meshes) {
        meshes.getOrPut(look to dark) { Bitmap.createBitmap(DeckMesh.pixels(look, dark), DeckMesh.WIDTH, DeckMesh.HEIGHT, Bitmap.Config.ARGB_8888) }
    }
}

abstract class LookView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    var color: String? = null
        set(value) {
            if (field != value) resolved = null
            field = value
        }
    var themeColors: List<String>? = null
        set(value) {
            if (field != value) resolved = null
            field = value
        }
    var darkThemeColors: List<String>? = null
        set(value) {
            if (field != value) resolved = null
            field = value
        }
    var dark: Boolean? = null

    private class Resolved(val look: ProfileLook, val lookOrNull: ProfileLook?)

    private var resolved: Resolved? = null

    private fun resolve(): Resolved =
        resolved ?: Resolved(LookRules.look(color, themeColors, darkThemeColors), LookRules.lookOrNull(color, themeColors, darkThemeColors)).also { resolved = it }

    protected val density: Float get() = resources.displayMetrics.density

    protected val isDark: Boolean
        get() = LookRules.dark(dark, resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES, lookOrNull)

    protected val look: ProfileLook get() = resolve().look

    protected val lookOrNull: ProfileLook? get() = resolve().lookOrNull

    protected val lookIsOff: Boolean get() = LookSwitch.isOff(context)

    protected var budgetDegraded: Boolean = false
        private set

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        budgetDegraded = LookBudget.isDegraded(context)
    }

    init {
        setWillNotDraw(false)
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) =
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

    open fun update() = invalidate()

    private var reportedFailure = false

    final override fun onDraw(canvas: Canvas) = drawSafely(canvas)

    internal fun drawSafely(canvas: Canvas) {
        if (width <= 0 || height <= 0) return
        val saved = canvas.saveCount
        try {
            drawLook(canvas)
        } catch (failure: Exception) {
            canvas.restoreToCount(saved)
            canvas.drawColor(fallbackColor())
            if (!reportedFailure) {
                reportedFailure = true
                android.util.Log.w("PAGELAB", "PAGELAB look ${javaClass.simpleName} could not draw at ${width}x$height and fell back to a flat colour: ${failure.javaClass.simpleName}: ${failure.message}")
            }
        }
    }

    protected abstract fun drawLook(canvas: Canvas)

    protected open fun fallbackColor(): Int = runCatching { SystemPalette.background.resolve(isDark).toArgb() }.getOrDefault(Color.GRAY)
}

internal object DeckBackdrops {
    private val shown = java.util.WeakHashMap<DeckBackdropView, Unit>()

    fun attach(view: DeckBackdropView) = synchronized(shown) { shown[view] = Unit }

    fun detach(view: DeckBackdropView) = synchronized(shown) { shown.remove(view) }

    fun all(): List<DeckBackdropView> = synchronized(shown) { shown.keys.toList() }
}

class DeckBackdropView(context: Context, appContext: AppContext) : LookView(context, appContext) {
    var reduceMotion: Boolean = false
    var reduceTransparency: Boolean = false

    private val meshPaint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val blobPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val source = Rect()
    private val target = Rect()
    private val centre = FloatArray(2)

    private var paintedLook: ProfileLook? = null
    private var paintedDark = false
    private var paintedRadius = -1f
    private var mesh: Bitmap? = null
    private var blobShaders: Array<Shader> = emptyArray()

    private fun prepare(look: ProfileLook, dark: Boolean, radius: Float) {
        if (look === paintedLook && dark == paintedDark && radius == paintedRadius && mesh != null) return
        if (paintedLook != null) post { enclosingSource()?.let(FrostSources::redrawFrostsOf) }
        paintedLook = look
        paintedDark = dark
        paintedRadius = radius
        mesh = LookPaint.mesh(look, dark)
        blobShaders = look.deckBlobs(dark).map { blob ->
            val argb = blob.toArgb()
            RadialGradient(0f, 0f, radius, intArrayOf(argb, argb and 0x00FFFFFF), null, Shader.TileMode.CLAMP)
        }.toTypedArray()
    }

    private val still: Boolean get() = reduceMotion || budgetDegraded

    private val noBlobs: Boolean get() = reduceTransparency || budgetDegraded

    internal val isAnimating: Boolean get() = isShown && !lookIsOff && !still && !noBlobs

    internal fun forgetPaint() {
        paintedLook = null
        mesh = null
        blobShaders = emptyArray()
        sample = null
        sampledFrame = -1L
    }

    internal var frames = 0L
        private set
    private var drawnMode: String? = null
    private var firstFrameAt = 0L

    internal val framesPerSecond: Int
        get() {
            val elapsed = SystemClock.uptimeMillis() - firstFrameAt
            return if (frames < 2 || elapsed <= 0) 0 else ((frames - 1) * 1000 / elapsed).toInt()
        }

    internal fun meshCentre(): Int {
        val mesh = LookPaint.mesh(look, isDark)
        return mesh.getPixel(mesh.width / 2, mesh.height / 2)
    }

    internal fun firstBlobCentre(): Pair<Float, Float> {
        val angle = if (still) 0f else angle(0, clock(SystemClock.uptimeMillis()))
        return LookRules.blobCenter(0, angle, width.toFloat(), height.toFloat())
    }

    internal fun describe(): String =
        "${width}x$height, ${frames} frames, ${framesPerSecond} fps, ${if (still) "still" else "moving"}, ${if (isDark) "dark" else "light"}, " +
            "transparency ${if (noBlobs) "reduced" else "on"}${if (budgetDegraded) " (look budget: degraded)" else ""}, mesh centre ${LookProbeText.hex(meshCentre())}"

    private val drawTimes = LongArray(64)
    private var drawIndex = 0
    private val counted = ViewTreeObserver.OnPreDrawListener {
        drawTimes[drawIndex] = SystemClock.uptimeMillis()
        drawIndex = (drawIndex + 1) % drawTimes.size
        true
    }
    private var clockBase = 0L
    private var runningSince = SystemClock.uptimeMillis()

    internal var heldStill = false
        private set

    private fun clock(now: Long): Long = if (heldStill) clockBase else clockBase + (now - runningSince)

    private fun holdStill(now: Long) {
        if (heldStill) return
        clockBase = clock(now)
        heldStill = true
    }

    private fun moveOn(now: Long) {
        if (!heldStill) return
        runningSince = now
        heldStill = false
    }

    private var paceMillis = 40L
    private val tick = Runnable {
        val now = SystemClock.uptimeMillis()
        if (LookRules.othersAreDrawing(drawTimes, now, paceMillis)) {
            holdStill(now)
            postDelayed(nextTick(), paceMillis)
        } else {
            moveOn(now)
            invalidate()
            enclosingSource()?.let(FrostSources::redrawTintedFrostsOf)
        }
    }

    private fun nextTick(): Runnable = tick

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        DeckBackdrops.attach(this)
        viewTreeObserver.addOnPreDrawListener(counted)
    }

    override fun onDetachedFromWindow() {
        DeckBackdrops.detach(this)
        viewTreeObserver.removeOnPreDrawListener(counted)
        removeCallbacks(tick)
        super.onDetachedFromWindow()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (PhoneLab.isOn) android.util.Log.i("PAGELAB", "PAGELAB look deck size ${oldw}x$oldh -> ${w}x$h")
    }

    override fun drawLook(canvas: Canvas) {
        val dark = isDark
        val look = look
        val drawn = "${if (dark) "dark" else "light"}, look $look, ${width}x$height, " +
            "${if (reduceMotion) "still (reduce motion)" else if (budgetDegraded) "still (look budget)" else "moving"}, " +
            "${if (reduceTransparency) "no blobs (reduce transparency)" else if (budgetDegraded) "no blobs (look budget)" else "blobs"}, " +
            if (lookIsOff) "look switched off in the lab: flat colour" else "look on"
        if (drawn != drawnMode) {
            drawnMode = drawn
            if (PhoneLab.isOn) {
                val asked = this.dark?.let { if (it) "dark" else "light" } ?: "the system's mode"
                android.util.Log.i("PAGELAB", "PAGELAB look deck draws $drawn (asked $asked${if (lookOrNull?.isAlwaysDark == true) ", this look is always dark" else ""})")
            }
        }
        if (frames == 0L) {
            firstFrameAt = SystemClock.uptimeMillis()
            if (PhoneLab.isOn) android.util.Log.i("PAGELAB", "PAGELAB look deck first frame ${width}x$height ${if (dark) "dark" else "light"} ${if (still) "still" else "moving"}")
        }
        frames += 1
        if (lookIsOff) {
            canvas.drawColor(LookSwitch.flatDeck(look, dark).toArgb())
            return
        }
        val w = width.toFloat()
        val h = height.toFloat()
        if (!drawScene(canvas, look, dark, w, h)) return
        if (noBlobs) return
        val animated = !still
        canvas.drawRect(0f, 0f, w, h, LookPaint.grain(density, DeckBackdropStyle.grainOpacity(dark)))
        removeCallbacks(tick)
        if (animated && isShown) {
            when (val delay = LookRules.nextBlobFrameMillis(LookSwitch.blobFramesPerSecond(context), w, h)) {
                0L -> {
                    postInvalidateOnAnimation()
                    postOnAnimation { enclosingSource()?.let(FrostSources::redrawTintedFrostsOf) }
                }
                else -> {
                    paceMillis = delay
                    postDelayed(tick, delay)
                }
            }
        }
    }

    override fun fallbackColor(): Int = runCatching { LookSwitch.flatDeck(look, isDark).toArgb() }.getOrDefault(super.fallbackColor())

    private fun drawScene(canvas: Canvas, look: ProfileLook, dark: Boolean, w: Float, h: Float): Boolean {
        val radius = LookRules.blobRadius(w, h)
        prepare(look, dark, radius)
        val meshBitmap = mesh ?: return false
        source.set(0, 0, meshBitmap.width, meshBitmap.height)
        target.set(0, 0, width + 1, height + 1)
        canvas.drawBitmap(meshBitmap, source, target, meshPaint)
        if (noBlobs) return true
        val animated = !still
        val now = clock(SystemClock.uptimeMillis())
        blobPaint.alpha = (DeckBackdropStyle.blobOpacity(dark) * 255f).toInt()
        for (index in blobShaders.indices) {
            val angle = if (animated) angle(index, now) else 0f
            LookRules.blobCenterInto(index, angle, w, h, centre)
            blobPaint.shader = blobShaders[index]
            val saved = canvas.save()
            canvas.translate(centre[0], centre[1])
            canvas.drawCircle(0f, 0f, radius, blobPaint)
            canvas.restoreToCount(saved)
        }
        return true
    }

    private var sample: Bitmap? = null
    private var sampledFrame = -1L

    internal fun sceneColours(left: Float, top: Float, right: Float, bottom: Float, out: IntArray): Boolean {
        if (width <= 0 || height <= 0 || lookIsOff) return false
        val w = width.toFloat()
        val h = height.toFloat()
        val sampleWidth = (width / FrostTint.SAMPLE_SCALE).coerceAtLeast(1)
        val sampleHeight = (height / FrostTint.SAMPLE_SCALE).coerceAtLeast(1)
        val kept = sample?.takeIf { it.width == sampleWidth && it.height == sampleHeight && sampledFrame == frames && paintedLook === look && paintedDark == isDark }
        val bitmap = kept ?: (sample?.takeIf { it.width == sampleWidth && it.height == sampleHeight }
            ?: Bitmap.createBitmap(sampleWidth, sampleHeight, Bitmap.Config.ARGB_8888).also { sample = it })
        if (kept == null) {
            bitmap.eraseColor(Color.TRANSPARENT)
            val canvas = Canvas(bitmap)
            canvas.scale(sampleWidth / w, sampleHeight / h)
            sampledFrame = -1L
            if (!drawScene(canvas, look, isDark, w, h)) return false
            sampledFrame = frames
        }
        val x0 = (left / w * sampleWidth).toInt().coerceIn(0, sampleWidth - 1)
        val x1 = (right / w * sampleWidth).toInt().coerceIn(x0 + 1, sampleWidth)
        val y0 = (top / h * sampleHeight).toInt().coerceIn(0, sampleHeight - 1)
        val y1 = (bottom / h * sampleHeight).toInt().coerceIn(y0 + 1, sampleHeight)
        val middle = ((y0 + y1) / 2).coerceIn(y0 + 1, y1)
        out[0] = FrostTint.average(bitmap, x0, y0, x1, middle)
        out[1] = FrostTint.average(bitmap, x0, if (middle < y1) middle else y0, x1, y1)
        return true
    }

    private fun enclosingSource(): FrostSourceView? {
        var current: android.view.ViewParent? = parent
        while (current != null) {
            if (current is FrostSourceView) return current
            current = current.parent
        }
        return null
    }

    private fun angle(index: Int, now: Long): Float {
        val loop = TabsBackdropMotion.loopsMillis[index]
        val progress = (now % loop).toFloat() / loop
        val full = (2 * PI).toFloat()
        return if (index % 2 == 0) full * progress else full * (1f - progress)
    }
}

class ProfileBackdropView(context: Context, appContext: AppContext) : LookView(context, appContext) {
    var themed: Boolean = false
    var softened: Boolean = false
    var fadesOut: Boolean = false

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val mask = Paint().apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN) }

    override fun drawLook(canvas: Canvas) {
        val dark = isDark
        val w = width.toFloat()
        val h = height.toFloat()
        if (lookIsOff) {
            canvas.drawColor(LookSwitch.flatBackdrop(look, dark, themed).toArgb())
            return
        }
        if (!fadesOut) {
            drawBackdrop(canvas, dark, w, h)
            return
        }
        paint.shader = null
        paint.color = SystemPalette.background.resolve(dark).toArgb()
        canvas.drawRect(0f, 0f, w, h, paint)
        val layer = canvas.saveLayer(0f, 0f, w, h, null)
        drawBackdrop(canvas, dark, w, h)
        val (positions, alphas) = LookRules.fadeMask()
        mask.shader = LinearGradient(0f, 0f, 0f, h, alphas.map { alpha -> Color.argb((alpha * 255f).toInt(), 0, 0, 0) }.toIntArray(), positions, Shader.TileMode.CLAMP)
        canvas.drawRect(0f, 0f, w, h, mask)
        canvas.restoreToCount(layer)
    }

    private fun drawBackdrop(canvas: Canvas, dark: Boolean, w: Float, h: Float) {
        val look = look
        val colors = look.backdropColors(dark, themed).map { it.toArgb() }.toIntArray()
        paint.shader = null
        if (colors.size >= 2) {
            val diagonal = look.showsTheme(dark, themed)
            paint.shader = LinearGradient(0f, 0f, if (diagonal) w else 0f, h, colors, null, Shader.TileMode.CLAMP)
        } else {
            paint.color = colors.firstOrNull() ?: Color.TRANSPARENT
        }
        canvas.drawRect(0f, 0f, w, h, paint)
        if (softened || fadesOut) {
            paint.shader = null
            paint.color = ProfileBackdropStyle.softening.resolve(dark).toArgb()
            canvas.drawRect(0f, 0f, w, h, paint)
        }
        canvas.drawRect(0f, 0f, w, h, LookPaint.grain(density, ProfileBackdropStyle.grainOpacity(dark)))
    }
}

class FilmGrainView(context: Context, appContext: AppContext) : LookView(context, appContext) {
    var opacity: Float = ProfileBackdropStyle.LIGHT_GRAIN

    override fun drawLook(canvas: Canvas) = Unit

    override fun dispatchDraw(canvas: Canvas) {
        super.dispatchDraw(canvas)
        if (lookIsOff || width <= 0 || height <= 0) return
        runCatching { canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), LookPaint.grain(density, opacity)) }
    }
}

internal object FrostSources {
    enum class PageMode(val raw: String) { Live("live"), Solid("solid") }

    private val sources = HashMap<String, WeakReference<FrostSourceView>>()
    private val frosts = java.util.WeakHashMap<FrostView, Unit>()

    @Volatile
    var pageMode: PageMode = PageMode.Solid

    fun register(id: String, view: FrostSourceView) = synchronized(sources) { sources[id] = WeakReference(view) }

    fun unregister(id: String, view: FrostSourceView) = synchronized(sources) {
        if (sources[id]?.get() === view) sources.remove(id)
    }

    fun find(id: String?): FrostSourceView? = id?.let { synchronized(sources) { sources[it]?.get() } }

    fun attach(view: FrostView) = synchronized(frosts) { frosts[view] = Unit }

    fun detach(view: FrostView) = synchronized(frosts) { frosts.remove(view) }

    fun frosts(): List<FrostView> = synchronized(frosts) { frosts.keys.toList() }

    fun allSources(): List<FrostSourceView> = synchronized(sources) { sources.values.mapNotNull { it.get() } }

    fun anyFrostCanBlur(id: String?): Boolean = id != null && frosts().any { it.source == id && it.isAttachedToWindow && it.wantsSource() }

    fun sourceChanged(id: String?) {
        find(id)?.invalidate()
    }

    fun redrawFrostsOf(source: FrostSourceView) {
        for (frost in frosts()) if (frost.source != null && find(frost.source) === source) frost.invalidate()
    }

    fun redrawTintedFrostsOf(source: FrostSourceView) {
        for (frost in frosts()) if (frost.lastChoice?.path == FrostPage.Path.Tinted && frost.source != null && find(frost.source) === source) frost.invalidate()
    }
}

class FrostSourceView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private var recorder: RenderNode? = null

    internal val node: RenderNode? get() = recorder

    internal val isRecording: Boolean get() = recorder != null

    var sourceId: String? = null
        set(value) {
            if (field == value) return
            field?.let { FrostSources.unregister(it, this) }
            field = value
            if (isAttachedToWindow) value?.let { FrostSources.register(it, this) }
        }

    internal val hasContent: Boolean get() = recorder?.hasDisplayList() == true

    private var pageKnown = false
    private var pageHeld = false

    internal val holdsPage: Boolean
        get() {
            if (!pageKnown) {
                pageHeld = FrostPage.holdsPage(this)
                pageKnown = true
            }
            return pageHeld
        }

    private var backdropKnown = false
    private var onlyBackdrop = false

    internal val holdsOnlyBackdrop: Boolean
        get() {
            if (!backdropKnown) {
                onlyBackdrop = FrostTint.onlyBackdrop(this)
                backdropKnown = true
            }
            return onlyBackdrop
        }

    internal fun backdrop(): DeckBackdropView? = FrostTint.firstBackdrop(this)

    private val laidOut = ViewTreeObserver.OnGlobalLayoutListener {
        pageKnown = false
        backdropKnown = false
    }

    private fun stopRecording() {
        recorder?.discardDisplayList()
        recorder = null
    }

    internal fun release() {
        stopRecording()
        invalidate()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) =
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        sourceId?.let { FrostSources.register(it, this) }
        viewTreeObserver.addOnGlobalLayoutListener(laidOut)
    }

    override fun onDetachedFromWindow() {
        viewTreeObserver.removeOnGlobalLayoutListener(laidOut)
        sourceId?.let { FrostSources.unregister(it, this) }
        stopRecording()
        super.onDetachedFromWindow()
    }

    override fun dispatchDraw(canvas: Canvas) {
        val wanted = canvas.isHardwareAccelerated && width > 0 && height > 0 && !LookSwitch.isOff(context) && FrostSources.anyFrostCanBlur(sourceId)
        if (!wanted) {
            if (recorder != null) stopRecording()
            super.dispatchDraw(canvas)
            return
        }
        val node = recorder ?: RenderNode("ardiaFrostSource").also { recorder = it }
        node.setPosition(0, 0, width, height)
        val recording = node.beginRecording(width, height)
        try {
            super.dispatchDraw(recording)
        } finally {
            node.endRecording()
        }
        canvas.drawRenderNode(node)
        FrostSources.redrawFrostsOf(this)
    }
}

internal object FrostPage {
    const val SOURCE_NOT_DRAWN = "source not drawn yet"

    fun holdsPage(view: View, sized: (View) -> Boolean = { it.width > 0 && it.height > 0 }): Boolean {
        if (view.visibility != View.VISIBLE) return false
        if (view is android.webkit.WebView) return sized(view)
        if (view !is android.view.ViewGroup) return false
        for (index in 0 until view.childCount) if (holdsPage(view.getChildAt(index), sized)) return true
        return false
    }

    enum class Path { Live, Solid, Fallback, Tinted }

    data class Choice(val path: Path, val reason: String)

    fun choose(
        blurSupported: Boolean,
        reduceTransparency: Boolean,
        budgetDegraded: Boolean = false,
        onlyBackdropUnder: Boolean = false,
        blurOverBackdrop: Boolean = false,
        hasSource: Boolean,
        sourceHasContent: Boolean,
        hardware: Boolean,
        insideSource: Boolean,
        holdsPage: Boolean,
        pageMode: FrostSources.PageMode,
        lookOff: Boolean = false,
    ): Choice = when {
        lookOff -> Choice(Path.Fallback, "look turned off in the lab")
        reduceTransparency -> Choice(Path.Fallback, "reduce transparency")
        budgetDegraded -> Choice(Path.Fallback, "look budget: this phone measured over budget")
        hasSource && onlyBackdropUnder && (!blurOverBackdrop || !blurSupported) -> Choice(Path.Tinted, "only the backdrop under it: a fill tinted from the backdrop's colours, no blur")
        !blurSupported -> Choice(Path.Fallback, "below Android 12")
        !hasSource -> Choice(Path.Fallback, "no source")
        !hardware -> Choice(Path.Fallback, "software canvas")
        insideSource -> Choice(Path.Fallback, "inside its own source")
        !sourceHasContent -> Choice(Path.Fallback, SOURCE_NOT_DRAWN)
        holdsPage && pageMode == FrostSources.PageMode.Solid -> Choice(Path.Solid, "page under the frost, solid page mode")
        holdsPage -> Choice(Path.Live, "page under the frost, redrawn every frame")
        else -> Choice(Path.Live, "no page under the frost")
    }
}

internal object FrostScale {
    const val MIN_LOW_RES_BLUR = 6f
    const val MAX_SCALE = 8f

    fun of(blurPixels: Float): Float = (blurPixels / MIN_LOW_RES_BLUR).toInt().toFloat().coerceIn(1f, MAX_SCALE)
}

internal object FrostRefresh {
    const val IDLE_MILLIS = 250L
    const val AFTER_SCROLL_MILLIS = 300L

    fun next(holdsPage: Boolean, millisSinceScroll: Long): Long? = when {
        !holdsPage -> null
        millisSinceScroll < AFTER_SCROLL_MILLIS -> 0L
        else -> IDLE_MILLIS
    }

    fun label(name: String?, source: String?, variant: String?, number: Int): String =
        name?.takeIf { it.isNotBlank() } ?: "${source ?: "-"}/${variant ?: "bar"} #$number"

    private var made = 0

    fun nextNumber(): Int = synchronized(this) { ++made }
}

class FrostView(context: Context, appContext: AppContext) : LookView(context, appContext) {
    var source: String? = null
    var name: String? = null
    var variant: String? = null

    private val number = FrostRefresh.nextNumber()

    internal val logLabel: String get() = FrostRefresh.label(name, source, variant, number)
    private var scrolledAt = 0L
    private val refresh = Runnable { invalidate() }
    private val scrolled = ViewTreeObserver.OnScrollChangedListener {
        if (lastChoice?.path == FrostPage.Path.Live && FrostSources.find(source)?.holdsPage == true) {
            scrolledAt = SystemClock.uptimeMillis()
            invalidate()
        }
    }
    var cornerRadius: Float = 0f
    var reduceTransparency: Boolean = false
        set(value) {
            if (field == value) return
            field = value
            FrostSources.sourceChanged(source)
        }

    private var blurNode: RenderNode? = null
    private var effectRadius = -1f
    private var effectSaturation = -1f
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val bounds = RectF()
    private val clip = Path()
    private val here = IntArray(2)
    private val there = IntArray(2)
    private var lastOffset = Long.MIN_VALUE

    private val moved = ViewTreeObserver.OnPreDrawListener {
        if (lastChoice?.path != FrostPage.Path.Live) return@OnPreDrawListener true
        val from = FrostSources.find(source)
        if (from != null) {
            val offset = offsetTo(from)
            if (offset != lastOffset) invalidate()
        }
        true
    }

    internal var lastChoice: FrostPage.Choice? = null
        private set

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        viewTreeObserver.addOnPreDrawListener(moved)
        viewTreeObserver.addOnScrollChangedListener(scrolled)
        FrostSources.attach(this)
        FrostSources.sourceChanged(source)
    }

    override fun onDetachedFromWindow() {
        FrostSources.detach(this)
        viewTreeObserver.removeOnPreDrawListener(moved)
        viewTreeObserver.removeOnScrollChangedListener(scrolled)
        removeCallbacks(refresh)
        forgetLayer()
        FrostSources.sourceChanged(source)
        super.onDetachedFromWindow()
    }

    internal fun canBlur(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && Frosting.isBlurSupported && !reduceTransparency && !lookIsOff && !budgetDegraded

    internal val holdsLayer: Boolean get() = blurNode != null

    internal var layerWidth = 0
        private set
    internal var layerHeight = 0
        private set

    internal fun forgetLayer() {
        blurNode?.discardDisplayList()
        blurNode = null
        effectRadius = -1f
        effectSaturation = -1f
        layerWidth = 0
        layerHeight = 0
    }

    internal fun wantsSource(): Boolean {
        if (!canBlur()) return false
        val choice = lastChoice ?: return true
        return choice.path == FrostPage.Path.Live || choice.reason == FrostPage.SOURCE_NOT_DRAWN
    }

    private fun report(choice: FrostPage.Choice) {
        if (choice == lastChoice) return
        val wanted = wantsSource()
        lastChoice = choice
        if (wantsSource() != wanted) FrostSources.sourceChanged(source)
        if (PhoneLab.isOn) {
            android.util.Log.i("PAGELAB", "PAGELAB look frost $logLabel ${width}x$height path=${choice.path.name.lowercase()} (${choice.reason})")
        }
    }

    override fun drawLook(canvas: Canvas) {
        val dark = isDark
        val style = LookRules.frost(variant, lookOrNull)
        val radius = cornerRadius * density
        bounds.set(0f, 0f, width.toFloat(), height.toFloat())
        clip.reset()
        clip.addRoundRect(bounds, radius, radius, Path.Direction.CW)
        val from = FrostSources.find(source)
        val blurs = canBlur()
        val choice = FrostPage.choose(
            blurSupported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && Frosting.isBlurSupported,
            reduceTransparency = reduceTransparency,
            budgetDegraded = budgetDegraded,
            onlyBackdropUnder = from?.holdsOnlyBackdrop == true,
            blurOverBackdrop = LookSwitch.blurOverBackdrop(context),
            hasSource = from != null,
            sourceHasContent = from?.hasContent == true,
            hardware = canvas.isHardwareAccelerated,
            insideSource = from != null && isInside(from),
            holdsPage = blurs && from?.holdsPage == true,
            pageMode = FrostSources.pageMode,
            lookOff = lookIsOff,
        )
        report(choice)
        if (choice.path == FrostPage.Path.Live && from != null) {
            if (isShown) scheduleRefresh(from.holdsPage)
            val layerNode = blurNode ?: RenderNode("ardiaFrost").also { blurNode = it }
            val blur = style.blurRadius.value * density
            val scale = FrostScale.of(blur)
            applyEffect(layerNode, blur / scale, style.saturation)
            val margin = ceil(blur * 2)
            val offset = offsetTo(from)
            lastOffset = offset
            val dx = (offset shr 32).toInt()
            val dy = offset.toInt()
            layerWidth = ceil((width + margin * 2) / scale).toInt()
            layerHeight = ceil((height + margin * 2) / scale).toInt()
            layerNode.setPosition(0, 0, layerWidth, layerHeight)
            val recording = layerNode.beginRecording()
            try {
                recording.scale(1f / scale, 1f / scale)
                recording.translate(dx + margin, dy + margin)
                from.node?.let(recording::drawRenderNode)
            } finally {
                layerNode.endRecording()
            }
            canvas.save()
            canvas.clipPath(clip)
            canvas.translate(-margin, -margin)
            canvas.scale(scale, scale)
            canvas.drawRenderNode(layerNode)
            canvas.restore()
            paint.style = Paint.Style.FILL
            paint.color = style.tint.resolve(dark).toArgb()
            canvas.drawPath(clip, paint)
        } else if (choice.path == FrostPage.Path.Tinted && from != null && tintedFill(canvas, from, style, dark)) {
            if (blurNode != null) forgetLayer()
            removeCallbacks(refresh)
        } else {
            if (blurNode != null) forgetLayer()
            removeCallbacks(refresh)
            paint.style = Paint.Style.FILL
            paint.color = style.fallback.resolve(dark).toArgb()
            canvas.drawPath(clip, paint)
        }
        style.edge?.let { edge ->
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = style.edgeWidth.value * density
            paint.color = edge.resolve(dark).toArgb()
            canvas.drawPath(clip, paint)
        }
    }

    private val sampled = IntArray(2)

    private fun tintedFill(canvas: Canvas, from: FrostSourceView, style: com.ardia.design.FrostedStyle, dark: Boolean): Boolean {
        val backdrop = from.backdrop() ?: return false
        backdrop.getLocationInWindow(there)
        getLocationInWindow(here)
        val left = (here[0] - there[0]).toFloat()
        val top = (here[1] - there[1]).toFloat()
        if (!backdrop.sceneColours(left, top, left + width, top + height, sampled)) return false
        val tint = style.tint.resolve(dark).toArgb()
        val upper = FrostTint.frosted(sampled[0], style.saturation, tint)
        val lower = FrostTint.frosted(sampled[1], style.saturation, tint)
        paint.style = Paint.Style.FILL
        paint.shader = LinearGradient(0f, 0f, 0f, height.toFloat(), upper, lower, Shader.TileMode.CLAMP)
        canvas.drawPath(clip, paint)
        paint.shader = null
        return true
    }

    private fun scheduleRefresh(holdsPage: Boolean) {
        removeCallbacks(refresh)
        when (val delay = FrostRefresh.next(holdsPage, SystemClock.uptimeMillis() - scrolledAt)) {
            null -> Unit
            0L -> postInvalidateOnAnimation()
            else -> postDelayed(refresh, delay)
        }
    }

    private fun applyEffect(layerNode: RenderNode, radius: Float, saturation: Float) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        if (radius == effectRadius && saturation == effectSaturation) return
        effectRadius = radius
        effectSaturation = saturation
        val blur = RenderEffect.createBlurEffect(radius, radius, Shader.TileMode.CLAMP)
        layerNode.setRenderEffect(
            if (saturation == 1f) {
                blur
            } else {
                val matrix = android.graphics.ColorMatrix().apply { setSaturation(saturation) }
                RenderEffect.createChainEffect(RenderEffect.createColorFilterEffect(android.graphics.ColorMatrixColorFilter(matrix)), blur)
            },
        )
    }

    private fun offsetTo(from: View): Long {
        from.getLocationInWindow(there)
        getLocationInWindow(here)
        val dx = there[0] - here[0]
        val dy = there[1] - here[1]
        return (dx.toLong() shl 32) or (dy.toLong() and 0xFFFFFFFFL)
    }

    private fun isInside(from: View): Boolean {
        var current: android.view.ViewParent? = parent
        while (current != null) {
            if (current === from) return true
            current = current.parent
        }
        return false
    }
}

internal object LookMemory {
    private const val MB = 1024.0 * 1024.0

    data class Counts(
        val sources: Int,
        val recording: Int,
        val frosts: Int,
        val holdingLayers: Int,
        val layerBytes: Long,
        val decks: Int,
        val animating: Int,
        val recordingNames: List<String> = emptyList(),
        val layerNames: List<String> = emptyList(),
        val heldStill: Int = 0,
        val tinted: Int = 0,
    )

    fun counts(): Counts {
        val sources = FrostSources.allSources()
        val frosts = FrostSources.frosts()
        val layered = frosts.filter { it.holdsLayer }
        val decks = DeckBackdrops.all()
        return Counts(
            sources = sources.size,
            recording = sources.count { it.isRecording },
            frosts = frosts.size,
            holdingLayers = layered.size,
            layerBytes = layered.sumOf { it.layerWidth.toLong() * it.layerHeight * 4 },
            decks = decks.size,
            animating = decks.count { it.isAnimating },
            recordingNames = sources.filter { it.isRecording }.map { it.sourceId ?: "?" },
            layerNames = layered.map { it.logLabel },
            heldStill = decks.count { it.heldStill },
            tinted = frosts.count { it.lastChoice?.path == FrostPage.Path.Tinted },
        )
    }

    fun line(context: Context): String {
        val counts = counts()
        val largest = FrostSources.frosts().filter { it.holdsLayer }.maxByOrNull { it.layerWidth.toLong() * it.layerHeight }
        return "look ${if (LookSwitch.isOff(context)) "off" else "on"}: ${counts.recording} of ${counts.sources} frost source(s) recording ${counts.recordingNames}, " +
            "${counts.holdingLayers} of ${counts.frosts} frost(s) holding a blur layer (${counts.tinted} tinted from the backdrop), about ${"%.1f".format(counts.layerBytes / MB)} MB" +
            (largest?.let { " (largest ${it.logLabel} ${it.layerWidth}x${it.layerHeight})" } ?: "") +
            ", ${counts.animating} of ${counts.decks} deck backdrop(s) animating (${counts.heldStill} held still while the screen moves), frosts with a layer ${counts.layerNames}"
    }

    fun trim(): String {
        val hidden = FrostSources.frosts().filter { !it.isShown && it.holdsLayer }
        hidden.forEach { it.forgetLayer() }
        DeckBackdrops.all().filter { !it.isShown }.forEach { it.forgetPaint() }
        LookPaint.forgetCaches()
        return "look trimmed: dropped ${hidden.size} hidden frost layer(s) and the look's paint caches"
    }

    fun releaseAll(): String {
        val before = counts()
        FrostSources.frosts().forEach {
            it.forgetLayer()
            it.invalidate()
        }
        FrostSources.allSources().forEach { it.release() }
        DeckBackdrops.all().forEach {
            it.forgetPaint()
            it.invalidate()
        }
        LookPaint.forgetCaches()
        return "look released for the hidden app: ${before.holdingLayers} frost layer(s) (about ${"%.1f".format(before.layerBytes / MB)} MB), " +
            "${before.recording} source recording(s), the deck paint and caches; all are rebuilt when the app is seen again"
    }

    fun release(level: Int): String = when {
        level >= android.content.ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN -> releaseAll()
        ImageMemory.clearsOn(level) -> trim()
        else -> "look kept"
    }
}

internal object FrostTint {
    const val SAMPLE_SCALE = 40

    fun average(bitmap: Bitmap, x0: Int, y0: Int, x1: Int, y1: Int): Int {
        var r = 0L
        var g = 0L
        var b = 0L
        var n = 0L
        for (y in y0 until y1) for (x in x0 until x1) {
            val pixel = bitmap.getPixel(x, y)
            if (Color.alpha(pixel) == 0) continue
            r += Color.red(pixel)
            g += Color.green(pixel)
            b += Color.blue(pixel)
            n += 1
        }
        if (n == 0L) return Color.GRAY
        return Color.rgb((r / n).toInt(), (g / n).toInt(), (b / n).toInt())
    }

    fun frosted(base: Int, saturation: Float, tint: Int): Int {
        val r = Color.red(base)
        val g = Color.green(base)
        val b = Color.blue(base)
        val luminance = 0.213f * r + 0.715f * g + 0.072f * b
        fun saturate(channel: Int) = (luminance + (channel - luminance) * saturation).coerceIn(0f, 255f)
        val alpha = Color.alpha(tint) / 255f
        fun over(channel: Float, tintChannel: Int) = (tintChannel * alpha + channel * (1f - alpha)).toInt().coerceIn(0, 255)
        return Color.rgb(over(saturate(r), Color.red(tint)), over(saturate(g), Color.green(tint)), over(saturate(b), Color.blue(tint)))
    }

    fun onlyBackdrop(view: View): Boolean {
        if (view is LookView) return view is DeckBackdropView || view is ProfileBackdropView || view is FilmGrainView
        if (view !is android.view.ViewGroup) return false
        if (view !is FrostSourceView && view.background != null) return false
        var any = false
        for (index in 0 until view.childCount) {
            val child = view.getChildAt(index)
            if (child.visibility == View.GONE) continue
            if (!onlyBackdrop(child)) return false
            any = true
        }
        return any
    }

    fun firstBackdrop(view: View): DeckBackdropView? {
        if (view is DeckBackdropView) return view
        if (view !is android.view.ViewGroup) return null
        for (index in 0 until view.childCount) firstBackdrop(view.getChildAt(index))?.let { return it }
        return null
    }
}
