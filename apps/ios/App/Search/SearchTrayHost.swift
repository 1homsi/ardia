import ArdiaDesign
import SwiftUI

struct SearchTrayHost: View {
  @Environment(AppModel.self) private var app
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.screenLayout) private var screenLayout
  @Environment(\.profileLook) private var look
  @Environment(\.usesGlass) private var usesGlass
  @ScaledMetric(relativeTo: .title3) private var fieldScale: CGFloat = 1
  @State private var shown: BrowseSession.SearchRequest?
  @State private var presentation = 0
  @State private var motion = TrayMotion()
  @State private var removalTask: Task<Void, Never>?

  static let removalPoll: Duration = .milliseconds(16)
  static let removalDeadline: Duration = .seconds(1.5)

  var body: some View {
    GeometryReader { proxy in
      let command = screenLayout.isWide ? CommandBarPlacement(proxy: proxy, lift: motion.lift) : nil
      let maxHeight = command?.maxHeight ?? maxHeight(in: proxy)
      TrayStage(
        motion: motion,
        content: shown.map { tray(for: $0, maxHeight: maxHeight, isCommandBar: command != nil) },
        commandTop: command.map { proxy.safeAreaInsets.top + $0.top }
      )
      .ignoresSafeArea()
      .accessibilityAddTraits(shown == nil ? [] : .isModal)
    }
    .ignoresSafeArea(.keyboard)
    .onAppear { motion.startTrackingKeyboard() }
    .onChange(of: reduceMotion, initial: true) { _, reduced in motion.reduceMotion = reduced }
    .task { await SearchSuggestionsModel.loadRecents(from: app.tabs) }
    .onChange(of: app.browse.search, initial: true) { _, request in
      if let request {
        present(request)
      } else if shown != nil {
        beginClosing()
      }
    }
  }

  private func tray(for request: BrowseSession.SearchRequest, maxHeight: CGFloat, isCommandBar: Bool) -> AnyView {
    AnyView(
      SearchTray(request: request, isFocused: focus, maxHeight: maxHeight, dismissDrag: dismissDrag)
        .id(presentation)
        .padding(.horizontal, isCommandBar ? DuoLayout.commandSide : 0)
        .environment(app)
        .environment(\.screenLayout, screenLayout)
        .environment(\.profileLook, look)
        .environment(\.usesGlass, usesGlass)
    )
  }

  private var focus: Binding<Bool> {
    Binding { motion.isFocused } set: { motion.isFocused = $0 }
  }

  private func maxHeight(in proxy: GeometryProxy) -> CGFloat {
    let preferred = BrowseLayout.sheetAboveKeyboard + BrowseLayout.searchFieldHeight * (fieldScale - 1)
    let available = proxy.size.height + proxy.safeAreaInsets.bottom - motion.lift - Spacing.tight - BrowseLayout.panelAboveKeyboard
    return max(min(preferred, available), 0)
  }

  private func present(_ request: BrowseSession.SearchRequest) {
    removalTask?.cancel()
    if shown == nil || motion.isClosing { presentation += 1 }
    shown = request
    app.browse.trayHoldsKeyboard = true
    motion.present(dimLevel: request.origin == .page ? BrowseLayout.trayDim : 0.001) { [app] in app.cancelSearch() }
  }

  private func refreshRecents() {
    let tabs = app.tabs
    Task {
      await SearchSuggestionsModel.loadRecents(from: tabs)
      try? await Task.sleep(for: .seconds(3))
      guard shown == nil else { return }
      await SearchSuggestionsModel.loadRecents(from: tabs)
    }
  }

  private func beginClosing() {
    guard !motion.isClosing else { return }
    motion.isFocused = false
    motion.close(departing: app.browse.searchEnding == .submitted)
    removalTask?.cancel()
    removalTask = Task {
      let deadline = ContinuousClock.now + Self.removalDeadline
      while !motion.hasSettled, ContinuousClock.now < deadline {
        try? await Task.sleep(for: Self.removalPoll)
        if Task.isCancelled { return }
      }
      guard !Task.isCancelled, motion.isClosing else { return }
      finish()
      refreshRecents()
    }
  }

  private func finish() {
    motion.finish()
    shown = nil
    app.browse.trayHoldsKeyboard = false
  }

  private var dismissDrag: some Gesture {
    DragGesture(minimumDistance: 6, coordinateSpace: .global)
      .onChanged { value in
        guard !motion.isClosing else { return }
        let translation = value.translation.height
        let releasesKeyboard = TrayDrag.releasesKeyboard(translation: translation) && motion.isFocused
        motion.dragChanged(translation: translation, releasingKeyboard: releasesKeyboard)
        if releasesKeyboard { motion.isFocused = false }
      }
      .onEnded { value in
        guard motion.isDragging else { return }
        let translation = motion.dragEnded(translation: value.translation.height)
        let trayVelocity = TrayDrag.trayVelocity(translation: translation, fingerVelocity: value.velocity.height)
        if TrayDrag.shouldDismiss(translation: translation, velocity: value.velocity.height, trayHeight: motion.trayHeight) {
          motion.releaseVelocity = trayVelocity
          app.cancelSearch()
        } else {
          if motion.heldLift != nil, !app.settings.isShowingOnboarding { motion.isFocused = true }
          motion.settle(velocity: trayVelocity)
        }
      }
  }
}
