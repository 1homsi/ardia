import ArdiaDesign
import SwiftUI
import UIKit

struct TrayMorphLook {
  var usesGlass: Bool
  var panelTint: UIColor
  var panelStyle: UIUserInterfaceStyle
  var classicPanel: UIColor
}

struct BarTarget {
  var owner: BarOwner
  var frame: CGRect
  var style: UIUserInterfaceStyle
}

struct BarArrival {
  let owner: BarOwner
  let size: CGSize
  let image: UIImage

  @MainActor
  func makeFace() -> UIView {
    let face = UIImageView(image: image)
    face.frame = CGRect(origin: .zero, size: size)
    face.isUserInteractionEnabled = false
    return face
  }

  func fits(_ target: BarTarget) -> Bool {
    owner == target.owner && abs(size.width - target.frame.width) < 1 && abs(size.height - target.frame.height) < 1
  }
}

@MainActor
final class TrayMorph {
  let view = TrayMorphView()
  private var flight: UIViewPropertyAnimator?
  private var folding: [UIViewPropertyAnimator] = []
  private var destination: CGRect?
  private var fades: [UIViewPropertyAnimator] = []
  private(set) var hasFlown = false

  static let contentFade = MotionCurve.easeOut(duration: 0.035)
  static let tintFade = MotionCurve(0.42, 0, 0.58, 1, duration: 0.16)
  static let handoff = Motion.trayHandOff
  static let flightSpring = Motion.smoothSpring
  static let arrival: CGFloat = 0.17
  static let arrivalFade = MotionCurve.easeOut(duration: 0.1)
  static let arrivalDelay: TimeInterval = 0.02

  struct Start {
    var frame: CGRect
    var radius: CGFloat
  }

  init(card: CGRect, fieldCenter: CGFloat, of tray: UIView, in stage: UIView, look: TrayMorphLook, from start: Start? = nil) {
    let cardFrame = tray.convert(card, to: stage).offsetBy(dx: 0, dy: Self.unfinishedTravel(of: tray))
    let snapshot = tray.resizableSnapshotView(from: card, afterScreenUpdates: false, withCapInsets: .zero)
    view.configure(look: look, contents: snapshot, cardSize: card.size, fieldCenter: fieldCenter)
    view.shape(to: start?.frame ?? cardFrame, radius: start?.radius ?? BrowseLayout.panelRadius)
    view.isHidden = true
    stage.addSubview(view)
  }

  private func appear() {
    UIView.performWithoutAnimation { view.isHidden = false }
  }

  private func startFades() {
    fades = [
      Self.run(Self.contentFade) { [view] in view.contents.alpha = 0 },
      Self.run(Self.tintFade) { [view] in view.tint.alpha = 0 },
    ]
  }

  var hasDestination: Bool { destination != nil }

  var isMoving: Bool {
    guard let flight, flight.isRunning || folding.contains(where: \.isRunning) else { return false }
    guard let destination, let shown = view.layer.presentation()?.frame else { return true }
    return Self.gap(between: shown, and: destination) > Self.arrival
  }

  private static func unfinishedTravel(of view: UIView) -> CGFloat {
    guard let shown = view.layer.presentation() else { return 0 }
    return shown.affineTransform().ty - view.transform.ty
  }

  private static func gap(between shown: CGRect, and target: CGRect) -> CGFloat {
    max(abs(shown.minX - target.minX), abs(shown.minY - target.minY), abs(shown.maxX - target.maxX), abs(shown.maxY - target.maxY))
  }

  func fly(to target: BarTarget, carrying arrival: BarArrival?, timing: UITimingCurveProvider, duration: TimeInterval) {
    guard !hasFlown else { return }
    hasFlown = true
    destination = target.frame
    appear()
    startFades()
    if let arrival, arrival.fits(target) {
      UIView.performWithoutAnimation { view.carry(arrival.makeFace()) }
      fades.append(Self.run(Self.arrivalFade, after: Self.arrivalDelay) { [view] in view.arrival.alpha = 1 })
    }
    let start = view.frame
    let radius = view.radius
    let dropped = CGRect(x: start.minX, y: target.frame.midY - start.height / 2, width: start.width, height: start.height)
    let folded = CGRect(x: start.minX, y: target.frame.midY - target.frame.height / 2, width: start.width, height: target.frame.height)
    let travel = UIViewPropertyAnimator(duration: duration, timingParameters: timing)
    travel.addAnimations { [view] in
      view.shape(to: dropped, radius: radius)
      view.settle(style: target.style)
    }
    let fold = UIViewPropertyAnimator(duration: Motion.trayFold.settlingDuration, timingParameters: Self.critical(Motion.trayFold))
    fold.addAnimations { [view] in view.shape(to: folded, radius: target.frame.height / 2) }
    let narrow = UIViewPropertyAnimator(duration: Motion.trayWiden.settlingDuration, timingParameters: Self.critical(Motion.trayWiden))
    narrow.addAnimations { [view] in view.shape(to: target.frame, radius: target.frame.height / 2) }
    travel.startAnimation()
    fold.startAnimation(afterDelay: Motion.trayFoldLag)
    narrow.startAnimation(afterDelay: Motion.trayFoldLag + Motion.trayFold.time(toReach: Motion.trayFoldBeforeNarrowing))
    flight = travel
    folding = [fold, narrow]
  }

  private static func critical(_ spring: Spring) -> UISpringTimingParameters {
    UISpringTimingParameters(duration: spring.duration, bounce: spring.bounce)
  }

  func vanish() {
    guard !hasFlown else { return }
    hasFlown = true
    appear()
    startFades()
    flight = Self.run(Self.handoff) { [view] in view.alpha = 0 }
  }

  func handOff() {
    if let destination {
      flight?.stopAnimation(true)
      folding.forEach { $0.stopAnimation(true) }
      UIView.performWithoutAnimation {
        view.shape(to: destination, radius: destination.height / 2)
        view.alpha = 0
      }
      DispatchQueue.main.async { self.remove() }
      return
    }
    let fade = Self.run(Self.handoff) { [view] in view.alpha = 0 }
    fade.addCompletion { _ in self.remove() }
  }

  func remove() {
    folding.forEach { $0.stopAnimation(true) }
    flight?.stopAnimation(true)
    fades.forEach { $0.stopAnimation(true) }
    view.removeFromSuperview()
  }

  @discardableResult
  private static func run(_ curve: MotionCurve, after delay: TimeInterval = 0, _ changes: @escaping () -> Void) -> UIViewPropertyAnimator {
    let animator = UIViewPropertyAnimator(duration: curve.duration, controlPoint1: curve.start, controlPoint2: curve.end, animations: changes)
    animator.startAnimation(afterDelay: delay)
    return animator
  }
}

final class TrayMorphView: UIView {
  private var surface = UIView()
  let tint = UIView()
  let contents = UIView()
  let arrival = UIView()
  private var classicFill: UIColor?
  private var cardSize = CGSize.zero
  private var fieldCenter: CGFloat = 0


  init() {
    super.init(frame: .zero)
    isUserInteractionEnabled = false
    accessibilityElementsHidden = true
    contents.clipsToBounds = true
    contents.layer.cornerCurve = .continuous
    arrival.alpha = 0
  }

  func carry(_ face: UIView) {
    arrival.subviews.forEach { $0.removeFromSuperview() }
    arrival.bounds = CGRect(origin: .zero, size: face.bounds.size)
    arrival.center = CGPoint(x: bounds.midX, y: bounds.midY)
    face.frame.origin = .zero
    arrival.addSubview(face)
  }

  private var fieldAnchor: CGPoint {
    CGPoint(x: bounds.midX, y: min(fieldCenter, bounds.height / 2))
  }

  required init?(coder: NSCoder) { nil }

  func configure(look: TrayMorphLook, contents snapshot: UIView?, cardSize: CGSize, fieldCenter: CGFloat) {
    self.cardSize = cardSize
    self.fieldCenter = fieldCenter
    if look.usesGlass {
      surface = UIVisualEffectView(effect: UIGlassEffect(style: .regular))
    } else {
      surface.backgroundColor = look.classicPanel
      surface.layer.borderWidth = 0.5
      surface.layer.borderColor = UIColor.label.withAlphaComponent(0.12).cgColor
      surface.layer.cornerCurve = .continuous
      classicFill = .systemBackground
    }
    surface.overrideUserInterfaceStyle = look.panelStyle
    tint.backgroundColor = look.panelTint
    tint.overrideUserInterfaceStyle = look.panelStyle
    tint.layer.cornerCurve = .continuous
    tint.clipsToBounds = true
    [tint, surface, contents, arrival].forEach(addSubview)
    if let snapshot {
      snapshot.frame = CGRect(origin: .zero, size: cardSize)
      contents.addSubview(snapshot)
    }
  }

  private(set) var radius: CGFloat = 0

  func shape(to frame: CGRect, radius: CGFloat) {
    self.radius = radius
    self.frame = frame
    let bounds = CGRect(origin: .zero, size: frame.size)
    for piece in [surface, tint, contents] {
      piece.frame = bounds
    }
    if let glass = surface as? UIVisualEffectView {
      glass.cornerConfiguration = .uniformCorners(radius: .fixed(radius))
    } else {
      surface.layer.cornerRadius = radius
    }
    tint.layer.cornerRadius = radius
    contents.layer.cornerRadius = radius
    let anchor = fieldAnchor
    arrival.center = CGPoint(x: bounds.midX, y: bounds.midY)
    guard let snapshot = contents.subviews.first, cardSize.width > 0 else { return }
    let scale = frame.width / cardSize.width
    snapshot.transform = CGAffineTransform(scaleX: scale, y: scale)
    snapshot.center = CGPoint(x: anchor.x, y: anchor.y + (cardSize.height / 2 - fieldCenter) * scale)
  }

  func settle(style: UIUserInterfaceStyle) {
    surface.overrideUserInterfaceStyle = style
    if let classicFill { surface.backgroundColor = classicFill }
  }
}

struct KeyboardClock {
  let timing: UITimingCurveProvider
  let duration: TimeInterval

  @MainActor
  init?(layer: CALayer) {
    let running = (layer.animationKeys() ?? []).compactMap { layer.animation(forKey: $0) }
    if let spring = running.lazy.compactMap({ $0 as? CASpringAnimation }).first {
      timing = UISpringTimingParameters(
        mass: spring.mass,
        stiffness: spring.stiffness,
        damping: spring.damping,
        initialVelocity: .zero
      )
      duration = spring.settlingDuration
    } else if let basic = running.lazy.compactMap({ $0 as? CABasicAnimation }).first, let function = basic.timingFunction {
      var start: [Float] = [0, 0]
      var end: [Float] = [0, 0]
      function.getControlPoint(at: 1, values: &start)
      function.getControlPoint(at: 2, values: &end)
      timing = UICubicTimingParameters(
        controlPoint1: CGPoint(x: CGFloat(start[0]), y: CGFloat(start[1])),
        controlPoint2: CGPoint(x: CGFloat(end[0]), y: CGFloat(end[1]))
      )
      duration = basic.duration
    } else {
      return nil
    }
  }
}
