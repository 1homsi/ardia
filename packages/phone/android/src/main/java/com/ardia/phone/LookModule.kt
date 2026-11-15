package com.ardia.phone

import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class LookModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("ArdiaPhoneLook")

        Function("setPageFrost") { mode: String ->
            check(PhoneLab.isOn) { "the page frost mode is a lab switch" }
            FrostSources.pageMode = FrostSources.PageMode.entries.firstOrNull { it.raw == mode } ?: FrostSources.PageMode.Live
            FrostSources.frosts().forEach { it.invalidate() }
            FrostSources.pageMode.raw
        }

        Function("setLookOff") { off: Boolean ->
            val context = appContext.reactContext ?: throw IllegalStateException("the app context is gone")
            LookSwitch.set(context, off)
            android.util.Log.i("PAGELAB", "PAGELAB look views ${if (off) "off: flat colours, no blur, grain or motion" else "on"} (takes effect for views drawn from now; force-stop to measure a clean launch)")
            FrostSources.frosts().forEach { it.invalidate() }
            FrostSources.allSources().forEach { it.invalidate() }
            off
        }

        Function("lookBudget") {
            val context = appContext.reactContext ?: throw IllegalStateException("the app context is gone")
            mapOf("state" to LookBudget.state(context), "version" to LookBudget.version(context), "forced" to LookBudget.forced(context))
        }

        Function("setLookBudget") { state: String ->
            val context = appContext.reactContext ?: throw IllegalStateException("the app context is gone")
            LookBudget.save(context, state)
        }

        Function("forceLookBudget") { applied: String? ->
            val context = appContext.reactContext ?: throw IllegalStateException("the app context is gone")
            LookBudget.force(context, applied?.takeIf { it == "full" || it == "degraded" })
            android.util.Log.i("PAGELAB", "PAGELAB look budget ${applied?.let { "forced $it" } ?: "measured again, not forced"} (from the next time the deck is built)")
        }

        AsyncFunction("sampleFrames") { millis: Double, promise: Promise ->
            val activity = appContext.currentActivity
            if (activity == null) {
                promise.resolve(null)
                return@AsyncFunction
            }
            FrameSampler.sample(activity, millis.toLong().coerceIn(100L, 10_000L)) { sample ->
                promise.resolve(sample?.let { mapOf("totals" to it.totals, "deadlines" to it.deadlines) })
            }
        }.runOnQueue(Queues.MAIN)

        Function("lookCounts") {
            val counts = LookMemory.counts()
            mapOf(
                "sources" to counts.sources,
                "recording" to counts.recording,
                "frosts" to counts.frosts,
                "holdingLayers" to counts.holdingLayers,
                "layerBytes" to counts.layerBytes.toDouble(),
                "decks" to counts.decks,
                "animating" to counts.animating,
                "recordingNames" to counts.recordingNames,
                "layerNames" to counts.layerNames,
                "heldStill" to counts.heldStill,
                "tinted" to counts.tinted,
            )
        }

        Function("setBlobFramesPerSecond") { rate: Int ->
            val context = appContext.reactContext ?: throw IllegalStateException("the app context is gone")
            LookSwitch.setBlobFramesPerSecond(context, rate)
            val kept = LookSwitch.blobFramesPerSecond(context)
            val shown = when {
                kept == LookRules.EVERY_FRAME -> "every frame (as Compose)"
                kept > 0 -> "at $kept fps"
                else -> "paced: a frame each time the fastest blob has moved ${(LookRules.BLOB_STEP_SHARE * 100).toInt()}% of its radius"
            }
            android.util.Log.i("PAGELAB", "PAGELAB look blobs $shown (lasts across launches; force-stop to measure a clean launch)")
            DeckBackdrops.all().forEach { it.invalidate() }
            kept
        }

        Function("setBlurOverBackdrop") { blur: Boolean ->
            val context = appContext.reactContext ?: throw IllegalStateException("the app context is gone")
            LookSwitch.setBlurOverBackdrop(context, blur)
            android.util.Log.i("PAGELAB", "PAGELAB look frosts over the backdrop alone ${if (blur) "blur it (as before)" else "are fills tinted from it"}")
            FrostSources.frosts().forEach { it.invalidate() }
            FrostSources.allSources().forEach { it.invalidate() }
            blur
        }

        Function("blurOverBackdrop") {
            val context = appContext.reactContext ?: return@Function false
            LookSwitch.blurOverBackdrop(context)
        }

        Function("blobFramesPerSecond") {
            val context = appContext.reactContext ?: return@Function 0
            LookSwitch.blobFramesPerSecond(context)
        }

        Function("lookIsOff") {
            val context = appContext.reactContext ?: return@Function false
            LookSwitch.isOff(context)
        }

        Function("probeFrosts") {
            check(PhoneLab.isOn) { "the frost probe is a lab tool" }
            appContext.currentActivity?.let(FrostProbe::probe)
            Unit
        }

        View(DeckBackdropView::class) {
            Name("DeckBackdrop")
            Prop("color") { view: DeckBackdropView, value: String? -> view.color = value }
            Prop("themeColors") { view: DeckBackdropView, value: List<String>? -> view.themeColors = value }
            Prop("darkThemeColors") { view: DeckBackdropView, value: List<String>? -> view.darkThemeColors = value }
            Prop("dark") { view: DeckBackdropView, value: Boolean? -> view.dark = value }
            Prop("reduceMotion") { view: DeckBackdropView, value: Boolean? -> view.reduceMotion = value == true }
            Prop("reduceTransparency") { view: DeckBackdropView, value: Boolean? -> view.reduceTransparency = value == true }
            OnViewDidUpdateProps { view -> view.update() }
        }

        View(ProfileBackdropView::class) {
            Name("ProfileBackdrop")
            Prop("color") { view: ProfileBackdropView, value: String? -> view.color = value }
            Prop("themeColors") { view: ProfileBackdropView, value: List<String>? -> view.themeColors = value }
            Prop("darkThemeColors") { view: ProfileBackdropView, value: List<String>? -> view.darkThemeColors = value }
            Prop("dark") { view: ProfileBackdropView, value: Boolean? -> view.dark = value }
            Prop("themed") { view: ProfileBackdropView, value: Boolean? -> view.themed = value == true }
            Prop("softened") { view: ProfileBackdropView, value: Boolean? -> view.softened = value == true }
            Prop("fadesOut") { view: ProfileBackdropView, value: Boolean? -> view.fadesOut = value == true }
            OnViewDidUpdateProps { view -> view.update() }
        }

        View(FilmGrainView::class) {
            Name("FilmGrain")
            Prop("opacity") { view: FilmGrainView, value: Float? -> view.opacity = value ?: com.ardia.design.ProfileBackdropStyle.LIGHT_GRAIN }
            OnViewDidUpdateProps { view -> view.update() }
        }

        View(FrostSourceView::class) {
            Name("FrostSource")
            Prop("name") { view: FrostSourceView, value: String? -> view.sourceId = value }
        }

        View(FrostView::class) {
            Name("Frost")
            Prop("source") { view: FrostView, value: String? -> view.source = value }
            Prop("name") { view: FrostView, value: String? -> view.name = value }
            Prop("variant") { view: FrostView, value: String? -> view.variant = value }
            Prop("cornerRadius") { view: FrostView, value: Float? -> view.cornerRadius = value ?: 0f }
            Prop("color") { view: FrostView, value: String? -> view.color = value }
            Prop("themeColors") { view: FrostView, value: List<String>? -> view.themeColors = value }
            Prop("darkThemeColors") { view: FrostView, value: List<String>? -> view.darkThemeColors = value }
            Prop("dark") { view: FrostView, value: Boolean? -> view.dark = value }
            Prop("reduceTransparency") { view: FrostView, value: Boolean? -> view.reduceTransparency = value == true }
            OnViewDidUpdateProps { view -> view.update() }
        }
    }
}
