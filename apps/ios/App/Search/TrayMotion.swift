import ArdiaDesign
import Observation
import SwiftUI
import UIKit

@MainActor
@Observable
final class TrayMotion {
  private(set) var lift: CGFloat = 0
  var isFocused = false
  @ObservationIgnored var reduceMotion = false
  @ObservationIgnored var releaseVelocity: CGFloat = 0
  @ObservationIgnored private(set) var isClosing = false
  @ObservationIgnored private(set) var isDragging = false
  @ObservationIgnored private(set) var heldLift: CGFloat?
  @ObservationIgnored private(set) lazy var controller: TrayStageController = {
    let controller = TrayStageController()
    controller.onResize = { [weak self] in self?.place() }
    return controller
  }()
  @ObservationIgnored private var keyboard: KeyboardTracker?
  @ObservationIgnored private var keyboardHeight: CGFloat = 0
  @ObservationIgnored private var isShown = false
  @ObservationIgnored private var isDeparting = false
  @ObservationIgnored private var hasLanded = false
  @ObservationIgnored private var dragOffset: CGFloat = 0
  @ObservationIgnored private var grabbedAt: CGFloat = 0
  @ObservationIgnored private var dimLevel: CGFloat = 0
  @ObservationIgnored private var dimShown = false
  @ObservationIgnored private var landingTask: Task<Void, Never>?
  @ObservationIgnored private var rise: UIViewPropertyAnimator?
  @ObservationIgnored private var releaseTask: Task<Void, Never>?

  static let keyboardThreshold: CGFloat = 120
  static let keyboardWait: Duration = .milliseconds(220)
  static let reducedMotion = MotionCurve.easeOut(duration: 0.2)

  enum Curve {
    case immediate
    case spring(Spring, velocity: CGFloat)
    case timing(MotionCurve)
  }

  var keyboardUp: Bool { keyboardHeight > Self.keyboardThreshold }
  var trayHeight: CGFloat { controller.trayHeight }
  var hasSettled: Bool { !keyboardUp && !controller.isAnimating }

  func startTrackingKeyboard() {
    guard keyboard == nil else { return }
    keyboard = KeyboardTracker(minimumHeight: Self.keyboardThreshold) { [weak self] height in
      self?.keyboardWillMove(to: height)
    }
    keyboard?.start()
  }

  func present(dimLevel: CGFloat, onDimTap: @escaping () -> Void) {
    landingTask?.cancel()
    releaseTask?.cancel()
    controller.dim.onTap = onDimTap
    move(.immediate) { [self] in
      self.dimLevel = dimLevel
      isShown = true
      isClosing = false
      isDeparting = false
      hasLanded = keyboardUp
      dragOffset = 0
      heldLift = nil
      isDragging = false
    }
    guard !hasLanded else { return }
    landingTask = Task { [weak self] in
      try? await Task.sleep(for: Self.keyboardWait)
      guard let self, !Task.isCancelled, isShown, !isClosing, !hasLanded else { return }
      rise = move(.timing(reduceMotion ? Self.reducedMotion : Motion.riseCurve)) { [self] in self.hasLanded = true }
    }
  }

  func close(departing: Bool) {
    landingTask?.cancel()
    releaseTask?.cancel()
    defer { releaseVelocity = 0 }
    if departing, !reduceMotion {
      heldLift = heldLift ?? liveLift
      move(.timing(Motion.departCurve)) { [self] in
        isClosing = true
        isDeparting = true
      }
    } else if keyboardUp, heldLift == nil {
      move(.immediate) { [self] in isClosing = true }
    } else {
      let travel = trayHeight + (heldLift ?? 0) + BrowseLayout.sheetTopRadius
      let slidesOut = heldLift != nil && !reduceMotion
      let distance = (slidesOut ? max(travel - dragOffset, 0) : 0) + (reduceMotion ? 0 : trayHeight + BrowseLayout.sheetTopRadius)
      let velocity = Motion.relativeVelocity(releaseVelocity, over: distance)
      move(reduceMotion ? .timing(Self.reducedMotion) : .spring(Motion.leaveSpring, velocity: velocity)) { [self] in
        isClosing = true
        if slidesOut { dragOffset = max(dragOffset, travel) }
      }
    }
  }

  func finish() {
    landingTask?.cancel()
    releaseTask?.cancel()
    move(.immediate) { [self] in
      isShown = false
      isClosing = false
      isDeparting = false
      hasLanded = false
      dragOffset = 0
      heldLift = nil
      isDragging = false
    }
  }

  func dragChanged(translation: CGFloat, releasingKeyboard: Bool) {
    if !isDragging {
      isDragging = true
      releaseTask?.cancel()
      grabbedAt = grabMidSpring()
    }
    if releasingKeyboard, heldLift == nil { heldLift = liveLift }
    move(.immediate) { [self] in dragOffset = TrayDrag.offset(for: grabbedAt + translation) }
  }

  func dragEnded(translation: CGFloat) -> CGFloat {
    isDragging = false
    defer { grabbedAt = 0 }
    return grabbedAt + translation
  }

  func settle(velocity trayVelocity: CGFloat) {
    let wasHolding = heldLift != nil
    let velocity = Motion.relativeVelocity(trayVelocity, over: -dragOffset)
    move(reduceMotion ? .timing(Self.reducedMotion) : .spring(Motion.smoothSpring, velocity: velocity)) { [self] in dragOffset = 0 }
    guard wasHolding else { return }
    releaseTask = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(650))
      guard let self, !Task.isCancelled, !isDragging, heldLift != nil else { return }
      move(.spring(Motion.smoothSpring, velocity: 0)) { [self] in self.heldLift = nil }
    }
  }

  private func keyboardWillMove(to height: CGFloat) {
    keyboardHeight = height
    if isShown, keyboardUp, !isClosing, !hasLanded {
      landingTask?.cancel()
      hasLanded = true
    }
    if let rise, rise.isRunning {
      UIView.performWithoutAnimation { rise.stopAnimation(true) }
    }
    rise = nil
    if !isDragging, let held = heldLift, abs(liveLift - held) < 2 {
      heldLift = nil
    }
    controller.keyboardSentinel.center.y = height
    place()
  }

  private var liveLift: CGFloat {
    let restsWithoutKeyboard = hasLanded && !keyboardUp && !isClosing
    return restsWithoutKeyboard ? max(keyboardHeight, safeBottom) : keyboardHeight
  }

  private var safeBottom: CGFloat {
    controller.view.window?.safeAreaInsets.bottom ?? 0
  }

  private var isUp: Bool { keyboardUp || (!isClosing && hasLanded) }

  private var isCommandBar: Bool { controller.commandTop != nil }

  private var trayOffset: CGFloat {
    let departure = isDeparting ? -BrowseLayout.trayDepartLift : 0
    guard !isCommandBar else { return dragOffset + departure }
    let restingDrop = isUp || isDeparting || reduceMotion ? 0 : trayHeight + BrowseLayout.sheetTopRadius
    return -(heldLift ?? liveLift) + dragOffset + restingDrop + departure
  }

  private func grabMidSpring() -> CGFloat {
    guard let presented = controller.tray.layer.presentation(), controller.tray.layer.animationKeys() != nil else { return TrayDrag.translation(for: dragOffset) }
    let visibleDrag = presented.affineTransform().ty - (trayOffset - dragOffset)
    controller.tray.layer.removeAllAnimations()
    controller.dim.layer.removeAllAnimations()
    return TrayDrag.translation(for: visibleDrag)
  }

  @discardableResult
  private func move(_ curve: Curve, _ changes: @escaping () -> Void) -> UIViewPropertyAnimator? {
    switch curve {
    case .immediate:
      UIView.performWithoutAnimation {
        changes()
        place()
      }
      return nil
    case .spring(let spring, let velocity):
      UIView.animate(springDuration: spring.duration, bounce: spring.bounce, initialSpringVelocity: velocity, delay: 0, options: [.allowUserInteraction]) {
        changes()
        self.place()
      }
      return nil
    case .timing(let timing):
      let animator = UIViewPropertyAnimator(duration: timing.duration, controlPoint1: timing.start, controlPoint2: timing.end) {
        changes()
        self.place()
      }
      animator.startAnimation()
      return animator
    }
  }

  private func place() {
    let tray = controller.tray
    let lift = heldLift ?? liveLift
    let scale: CGFloat = isCommandBar && !isUp && !reduceMotion ? 0.96 : 1
    tray.isHidden = !isShown
    tray.transform = CGAffineTransform(translationX: 0, y: trayOffset).scaledBy(x: scale, y: scale)
    tray.alpha = isDeparting ? 0 : isUp || (!reduceMotion && !isCommandBar) ? 1 : 0
    tray.takesTouches = isShown && !isClosing
    tray.accessibilityViewIsModal = isShown
    placeDim(progress: TrayDrag.progress(offset: dragOffset, travel: trayHeight + lift))
    if self.lift != lift { self.lift = lift }
  }

  private func placeDim(progress: CGFloat) {
    let dim = controller.dim
    let shows = isShown && isUp
    dim.backgroundColor = UIColor.black.withAlphaComponent(dimLevel)
    dim.isUserInteractionEnabled = shows && !isClosing
    let alpha = shows ? 1 - progress : 0
    guard shows != dimShown else {
      dim.alpha = alpha
      return
    }
    dimShown = shows
    let fade = reduceMotion ? Motion.fadeCurve : Motion.trayDimCurve
    UIViewPropertyAnimator(duration: fade.duration, controlPoint1: fade.start, controlPoint2: fade.end) {
      dim.alpha = alpha
    }.startAnimation()
  }
}
