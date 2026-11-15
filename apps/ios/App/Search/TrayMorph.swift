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
  var frame: CGRect
  var style: UIUserInterfaceStyle
}

@MainActor
final class TrayMorph {
  let view = TrayMorphView()
  private var flight: UIViewPropertyAnimator?
  private var destination: CGRect?
  private var fades: [UIViewPropertyAnimator] = []
  private(set) var hasFlown = false

  static let contentFade = Motion.fadeCurve
  static let tintFade = MotionCurve.easeOut(duration: 0.28)
  static let handoff = Motion.fadeCurve
  static let flightSpring = Motion.smoothSpring
  static let arrival: CGFloat = 2

  init(card: CGRect, of tray: UIView, in stage: UIView, look: TrayMorphLook) {
    let frame = tray.convert(card, to: stage)
    view.configure(look: look, contents: tray.resizableSnapshotView(from: card, afterScreenUpdates: false, withCapInsets: .zero))
    view.shape(to: frame, radius: BrowseLayout.panelRadius)
    stage.addSubview(view)
    fades = [
      Self.run(Self.contentFade) { [view] in view.contents.alpha = 0 },
      Self.run(Self.tintFade) { [view] in view.tint.alpha = 0 },
    ]
  }

  var hasDestination: Bool { destination != nil }

  var isMoving: Bool {
    guard let flight, flight.isRunning else { return false }
    guard let destination else { return true }
    return Self.gap(between: view.layer.presentation()?.frame ?? view.frame, and: destination) > Self.arrival
  }

  private static func gap(between shown: CGRect, and target: CGRect) -> CGFloat {
    max(abs(shown.minX - target.minX), abs(shown.minY - target.minY), abs(shown.maxX - target.maxX), abs(shown.maxY - target.maxY))
  }

  func fly(to target: BarTarget, timing: UITimingCurveProvider, duration: TimeInterval) {
    guard !hasFlown else { return }
    hasFlown = true
    destination = target.frame
    let animator = UIViewPropertyAnimator(duration: duration, timingParameters: timing)
    animator.addAnimations { [view] in
      view.shape(to: target.frame, radius: target.frame.height / 2)
      view.settle(style: target.style)
    }
    animator.startAnimation()
    flight = animator
  }

  func vanish() {
    guard !hasFlown else { return }
    hasFlown = true
    flight = Self.run(Self.handoff) { [view] in view.alpha = 0 }
  }

  func handOff() {
    let fade = Self.run(Self.handoff) { [view] in view.alpha = 0 }
    fade.addCompletion { _ in self.remove() }
  }

  func remove() {
    flight?.stopAnimation(true)
    fades.forEach { $0.stopAnimation(true) }
    view.removeFromSuperview()
  }

  @discardableResult
  private static func run(_ curve: MotionCurve, _ changes: @escaping () -> Void) -> UIViewPropertyAnimator {
    let animator = UIViewPropertyAnimator(duration: curve.duration, controlPoint1: curve.start, controlPoint2: curve.end, animations: changes)
    animator.startAnimation()
    return animator
  }
}

final class TrayMorphView: UIView {
  private var surface = UIView()
  let tint = UIView()
  let contents = UIView()
  private var classicFill: UIColor?

  init() {
    super.init(frame: .zero)
    isUserInteractionEnabled = false
    accessibilityElementsHidden = true
    contents.clipsToBounds = true
    contents.layer.cornerCurve = .continuous
  }

  required init?(coder: NSCoder) { nil }

  func configure(look: TrayMorphLook, contents snapshot: UIView?) {
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
    [surface, tint, contents].forEach(addSubview)
    if let snapshot {
      snapshot.frame.origin = .zero
      contents.addSubview(snapshot)
    }
  }

  func shape(to frame: CGRect, radius: CGFloat) {
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
