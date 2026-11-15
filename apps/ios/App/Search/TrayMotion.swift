import ArdiaDesign
import Observation
import SwiftUI
import UIKit

@MainActor
@Observable
final class TrayMotion {
  private(set) var lift: CGFloat = 0
  private(set) var revealsContents = true
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
  @ObservationIgnored var barTarget: () -> BarTarget? = { nil }
  @ObservationIgnored var fieldCenter = BrowseLayout.panelFieldInset + BrowseLayout.searchFieldHeight / 2
  @ObservationIgnored private var morph: TrayMorph?
  @ObservationIgnored private var fadingMorph: TrayMorph?
  @ObservationIgnored private var arrival: BarArrival?
  @ObservationIgnored private var awaitedFlight: CGFloat?
  @ObservationIgnored private var flightFallback: Task<Void, Never>?
  @ObservationIgnored private var emergence: TrayEmergence?
  @ObservationIgnored private var emergenceTask: Task<Void, Never>?

  static let keyboardThreshold: CGFloat = 120
  static let keyboardWait: Duration = .milliseconds(220)
  static let reducedMotion = MotionCurve.easeOut(duration: 0.2)
  static let keyboardGrace: Duration = .milliseconds(50)

  enum Curve {
    case immediate
    case spring(Spring, velocity: CGFloat)
    case timing(MotionCurve)
  }

  var keyboardUp: Bool { keyboardHeight > Self.keyboardThreshold }
  var trayHeight: CGFloat { controller.trayHeight }
  var isLanding: Bool { morph?.hasDestination == true }

  var hasSettled: Bool {
    guard !keyboardUp, awaitedFlight == nil else { return false }
    guard let morph else { return !controller.isAnimating }
    return !morph.isMoving
  }

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
    dropMorph()
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

  func rememberBar(_ target: BarTarget?, face: UIImage?) {
    guard let target, let face else {
      arrival = nil
      return
    }
    arrival = BarArrival(owner: target.owner, size: target.frame.size, image: face)
  }

  func emerge(from target: BarTarget?) {
    endEmergence()
    guard let target, !keyboardUp, !isCommandBar else { return }
    let face = arrival.flatMap { $0.fits(target) ? $0.makeFace() : nil }
    revealsContents = false
    emergence = TrayEmergence(pill: controller.view.convert(target.frame, from: nil), fieldCenter: fieldCenter, face: face, on: controller.tray)
  }

  func close(departing: Bool, morphing look: TrayMorphLook?) {
    landingTask?.cancel()
    releaseTask?.cancel()
    defer { releaseVelocity = 0 }
    let shownSurface = emergence.map { $0.shownSurface(of: controller.tray, card: card, in: controller.view) }
    endEmergence()
    if !departing, !reduceMotion, !isCommandBar, let look {
      beginMorph(look: look, from: shownSurface)
    } else if departing, !reduceMotion {
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
    handOffMorph()
    endEmergence()
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
      endEmergence()
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
    if let velocity = awaitedFlight, !keyboardUp { flyMorph(velocity: velocity) }
  }

  private var card: CGRect {
    CGRect(
      x: BrowseLayout.panelInset,
      y: 0,
      width: controller.tray.bounds.width - 2 * BrowseLayout.panelInset,
      height: max(trayHeight - BrowseLayout.panelAboveKeyboard, 0)
    )
  }

  private func beginMorph(look: TrayMorphLook, from shownSurface: TrayMorph.Start?) {
    morph = TrayMorph(card: card, fieldCenter: fieldCenter, of: controller.tray, in: controller.view, look: look, from: shownSurface)
    let velocity = releaseVelocity
    move(.immediate) { [self] in isClosing = true }
    awaitedFlight = velocity
    DispatchQueue.main.async { [weak self] in self?.launchMorph() }
  }

  private func launchMorph() {
    guard let velocity = awaitedFlight else { return }
    guard keyboardUp else {
      flyMorph(velocity: velocity)
      return
    }
    flightFallback?.cancel()
    flightFallback = Task { [weak self] in
      try? await Task.sleep(for: Self.keyboardGrace)
      guard let self, !Task.isCancelled, let velocity = awaitedFlight else { return }
      flyMorph(velocity: velocity)
    }
  }

  private func flyMorph(velocity: CGFloat) {
    flightFallback?.cancel()
    awaitedFlight = nil
    guard let morph else { return }
    guard var target = barTarget() else {
      morph.vanish()
      hideTrayUnderMorph()
      return
    }
    target.frame = controller.view.convert(target.frame, from: nil)
    if abs(velocity) < 1, let clock = KeyboardClock(layer: controller.keyboardSentinel.layer) {
      morph.fly(to: target, carrying: arrival, timing: clock.timing, duration: clock.duration)
    } else {
      let distance = target.frame.midY - morph.view.frame.midY
      let spring = TrayMorph.flightSpring
      let timing = UISpringTimingParameters(
        duration: spring.duration,
        bounce: spring.bounce,
        initialVelocity: CGVector(dx: 0, dy: Motion.relativeVelocity(velocity, over: distance))
      )
      morph.fly(to: target, carrying: arrival, timing: timing, duration: spring.settlingDuration)
    }
    hideTrayUnderMorph()
  }

  private func hideTrayUnderMorph() {
    UIView.performWithoutAnimation { controller.tray.alpha = 0 }
  }

  private func handOffMorph() {
    flightFallback?.cancel()
    awaitedFlight = nil
    fadingMorph?.remove()
    fadingMorph = morph
    morph?.handOff()
    morph = nil
  }

  private func awaitEmergence() {
    guard emergenceTask == nil else { return }
    emergenceTask = Task { [weak self] in
      let deadline = ContinuousClock.now + TrayEmergence.settleDeadline
      repeat {
        try? await Task.sleep(for: TrayEmergence.settlePoll)
        if Task.isCancelled { return }
      } while self?.emergence?.isSettled == false && ContinuousClock.now < deadline
      self?.endEmergence()
    }
  }

  private func revealContentsNextTurn() {
    guard !revealsContents else { return }
    DispatchQueue.main.async { [weak self] in
      guard let self, !self.revealsContents else { return }
      self.revealsContents = true
    }
  }

  func fieldDidReveal(at base: CFTimeInterval) {
    emergence?.fadeFace(from: base)
  }

  private func endEmergence() {
    emergenceTask?.cancel()
    emergenceTask = nil
    emergence?.fadeFace(from: CACurrentMediaTime())
    emergence?.end(on: controller.tray)
    emergence = nil
    if !revealsContents { revealsContents = true }
  }

  private func dropMorph() {
    flightFallback?.cancel()
    awaitedFlight = nil
    morph?.remove()
    morph = nil
    fadingMorph?.remove()
    fadingMorph = nil
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
    if let emergence, !isUp, !isClosing {
      return emergence.restingOffset(trayHeight: trayHeight, stageBottom: controller.view.bounds.maxY) + dragOffset
    }
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
    tray.alpha = isDeparting || morph?.hasFlown == true ? 0 : isUp || (!reduceMotion && !isCommandBar) ? 1 : 0
    if let emergence {
      emergence.place(on: tray, in: controller.view, card: card, isOpen: isUp)
      if isUp {
        awaitEmergence()
        revealContentsNextTurn()
      }
    }
    let isUnrevealed = emergence != nil && !isUp
    tray.takesTouches = isShown && !isClosing && !isUnrevealed
    tray.accessibilityElementsHidden = isUnrevealed
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
