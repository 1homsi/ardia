import ArdiaDesign
import SwiftUI
import UIKit

extension MotionCurve {
  var mediaTimingFunction: CAMediaTimingFunction {
    CAMediaTimingFunction(controlPoints: Float(start.x), Float(start.y), Float(end.x), Float(end.y))
  }

  func animator(_ changes: @escaping () -> Void) -> UIViewPropertyAnimator {
    UIViewPropertyAnimator(duration: duration, controlPoint1: start, controlPoint2: end, animations: changes)
  }
}

extension Spring {
  static let fullyThere: CGFloat = 0.98

  var timingParameters: UISpringTimingParameters {
    UISpringTimingParameters(duration: duration, bounce: bounce)
  }

  func timingParameters(initialVelocity: CGFloat) -> UISpringTimingParameters {
    UISpringTimingParameters(duration: duration, bounce: bounce, initialVelocity: CGVector(dx: 0, dy: initialVelocity))
  }

  func criticalProgress(at time: Double) -> Double {
    let omega = 2 * Double.pi / duration
    return 1 - (1 + omega * time) * exp(-omega * time)
  }

  func time(toReach progress: CGFloat) -> CFTimeInterval {
    let target = min(max(progress, 0), Self.fullyThere)
    guard target > 0 else { return 0 }
    var time = 0.0
    while time < settlingDuration {
      if criticalProgress(at: time) >= Double(target) { return time }
      time += 0.002
    }
    return settlingDuration
  }
}

extension UIView {
  func restartOpacityFade(to opacity: Float, after delay: CFTimeInterval, from base: CFTimeInterval, curve: MotionCurve) {
    let from = (layer.presentation() ?? layer).opacity
    UIView.performWithoutAnimation {
      CATransaction.begin()
      CATransaction.setDisableActions(true)
      layer.removeAllAnimations()
      layer.opacity = opacity
      CATransaction.commit()
    }
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.fromValue = from
    fade.toValue = opacity
    fade.beginTime = base + delay
    fade.duration = curve.duration
    fade.fillMode = .backwards
    fade.timingFunction = curve.mediaTimingFunction
    layer.add(fade, forKey: "fade")
  }
}

@MainActor
enum SettlePoll {
  static func until(every interval: Duration, within limit: Duration, _ isDone: () -> Bool) async -> Bool {
    let deadline = ContinuousClock.now + limit
    while !isDone(), ContinuousClock.now < deadline {
      try? await Task.sleep(for: interval)
      if Task.isCancelled { return false }
    }
    return !Task.isCancelled
  }
}
