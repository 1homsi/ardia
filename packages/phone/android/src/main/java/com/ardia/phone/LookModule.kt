package com.ardia.phone

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
            off
        }

        Function("setBlobFramesPerSecond") { rate: Int ->
            val context = appContext.reactContext ?: throw IllegalStateException("the app context is gone")
            LookSwitch.setBlobFramesPerSecond(context, rate)
            val kept = LookSwitch.blobFramesPerSecond(context)
            android.util.Log.i("PAGELAB", "PAGELAB look blobs ${if (kept == 0) "every frame (as Compose)" else "at $kept fps"} (lasts across launches; force-stop to measure a clean launch)")
            DeckBackdrops.all().forEach { it.invalidate() }
            kept
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
