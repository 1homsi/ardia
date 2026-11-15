import ArdiaDesign
import SwiftUI

enum BarOwner: Hashable {
  case start
  case page
}

struct BarAnchor: Equatable {
  var frame: CGRect
  var isDark: Bool
  var content: BarFace.Content
  var reporter: UUID
}

enum BarSlot {
  case leading
  case centre
  case trailing

  var outward: CGFloat {
    switch self {
    case .leading: -BrowseLayout.barReturnShift
    case .centre: 0
    case .trailing: BrowseLayout.barReturnShift
    }
  }
}

private struct BarReturn: ViewModifier {
  let slot: BarSlot
  let isShown: Bool

  @Environment(AppModel.self) private var app
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.screenLayout) private var screenLayout

  func body(content: Content) -> some View {
    let grows = !isShown && !reduceMotion && slot != .centre
    content
      .scaleEffect(grows ? BrowseLayout.barReturnScale : 1)
      .offset(x: grows ? slot.outward : 0)
      .opacity(isShown ? 1 : 0)
      .animation(animation, value: isShown)
  }

  private var animation: Animation? {
    if reduceMotion { return Motion.barReturnFade }
    guard isShown else {
      if slot == .centre { return app.browse.search != nil && screenLayout == .phone ? nil : Motion.fade }
      return Motion.barLeave
    }
    switch slot {
    case .centre: return app.browse.isBarLanding ? nil : Motion.barReturnFade
    case .leading, .trailing: return Motion.barReturn.delay(Motion.barReturnDelay)
    }
  }
}

private struct BarAnchorReport: ViewModifier {
  let owner: BarOwner
  let face: BarFace.Content

  @Environment(AppModel.self) private var app
  @Environment(\.colorScheme) private var colorScheme
  @State private var reporter = UUID()
  @State private var frame = CGRect.null

  func body(content: Content) -> some View {
    content
      .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { frame in
        self.frame = frame
        report()
      }
      .onChange(of: colorScheme) { _, _ in report() }
      .onChange(of: face) { _, _ in report() }
      .onAppear(perform: report)
      .onDisappear {
        if app.browse.barAnchors[owner]?.reporter == reporter { app.browse.barAnchors[owner] = nil }
      }
  }

  private func report() {
    guard !frame.isNull else { return }
    let anchor = BarAnchor(frame: frame, isDark: colorScheme == .dark, content: face, reporter: reporter)
    guard app.browse.barAnchors[owner] != anchor else { return }
    app.browse.barAnchors[owner] = anchor
    app.browse.barAnchorRevision &+= 1
  }
}

extension View {
  func barReturn(_ slot: BarSlot, isShown: Bool) -> some View {
    modifier(BarReturn(slot: slot, isShown: isShown))
  }

  func reportsBarAnchor(_ owner: BarOwner, face: BarFace.Content) -> some View {
    modifier(BarAnchorReport(owner: owner, face: face))
  }
}
