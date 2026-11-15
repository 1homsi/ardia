import ExpoModulesCore
import QuartzCore
import UIKit

struct MotionTargetRecord: Record {
  @Field var opacity: Double = 1
  @Field var translateX: Double = 0
  @Field var translateY: Double = 0
  @Field var scale: Double = 1
}

struct MotionCurveRecord: Record {
  @Field var type: String = "timing"
  @Field var durationMs: Double = 200
  @Field var curve: [Double]? = nil
  @Field var response: Double = 0.26
  @Field var dampingFraction: Double = 1
}

struct MotionValues: Equatable {
  var opacity: CGFloat
  var translateX: CGFloat
  var translateY: CGFloat
  var scale: CGFloat

  init(_ record: MotionTargetRecord) {
    opacity = CGFloat(min(max(record.opacity, 0), 1))
    translateX = CGFloat(record.translateX)
    translateY = CGFloat(record.translateY)
    scale = CGFloat(record.scale)
  }

  init(presentation layer: CALayer) {
    opacity = CGFloat(layer.opacity)
    translateX = (layer.value(forKeyPath: "transform.translation.x") as? CGFloat) ?? 0
    translateY = (layer.value(forKeyPath: "transform.translation.y") as? CGFloat) ?? 0
    scale = (layer.value(forKeyPath: "transform.scale.x") as? CGFloat) ?? 1
  }

  var transform: CATransform3D {
    CATransform3DScale(CATransform3DMakeTranslation(translateX, translateY, 0), scale, scale, 1)
  }
}

final class MotionView: ExpoView {
  let onMotionEnd = EventDispatcher()
  var target = MotionTargetRecord()
  var curve = MotionCurveRecord()
  private var shown: MotionValues?
  private var generation = 0

  static let keys = ["opacity": "ardia.motion.opacity", "transform.translation.x": "ardia.motion.x", "transform.translation.y": "ardia.motion.y", "transform.scale": "ardia.motion.scale"]

  func apply() {
    let next = MotionValues(target)
    guard next != shown else { return }
    let from = shown == nil ? nil : MotionValues(presentation: layer.presentation() ?? layer)
    let animates = from != nil && window != nil && !UIAccessibility.isReduceMotionEnabled
    shown = next
    generation += 1
    let current = generation
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    if animates, let from {
      CATransaction.setCompletionBlock { [weak self] in
        guard let self, self.generation == current else { return }
        self.onMotionEnd(["finished": true])
      }
      add("opacity", from: from.opacity, to: next.opacity)
      add("transform.translation.x", from: from.translateX, to: next.translateX)
      add("transform.translation.y", from: from.translateY, to: next.translateY)
      add("transform.scale", from: from.scale, to: next.scale)
    } else {
      for key in Self.keys.values { layer.removeAnimation(forKey: key) }
    }
    layer.opacity = Float(next.opacity)
    layer.transform = next.transform
    CATransaction.commit()
    if from != nil, !animates {
      onMotionEnd(["finished": true])
    }
  }

  private func add(_ keyPath: String, from: CGFloat, to: CGFloat) {
    guard let key = Self.keys[keyPath] else { return }
    guard abs(from - to) > 0.0001 else {
      layer.removeAnimation(forKey: key)
      return
    }
    let animation = makeAnimation(keyPath)
    animation.fromValue = from
    animation.toValue = to
    animation.isRemovedOnCompletion = true
    layer.add(animation, forKey: key)
  }

  private func makeAnimation(_ keyPath: String) -> CABasicAnimation {
    if curve.type == "spring" {
      let response = max(curve.response, 0.01)
      let bounce = max(min(1 - curve.dampingFraction, 1), -1)
      let spring = CASpringAnimation(perceptualDuration: response, bounce: bounce)
      spring.keyPath = keyPath
      spring.duration = spring.settlingDuration
      return spring
    }
    let animation = CABasicAnimation(keyPath: keyPath)
    animation.duration = max(curve.durationMs, 0) / 1000
    if let points = curve.curve, points.count == 4 {
      animation.timingFunction = CAMediaTimingFunction(controlPoints: Float(points[0]), Float(points[1]), Float(points[2]), Float(points[3]))
    } else {
      animation.timingFunction = CAMediaTimingFunction(name: .easeOut)
    }
    return animation
  }
}

public final class MotionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaPhoneMotion")

    Constant("runsInRenderServer") { true }

    View(MotionView.self) {
      Events("onMotionEnd")

      Prop("to") { (view: MotionView, target: MotionTargetRecord?) in
        view.target = target ?? MotionTargetRecord()
      }

      Prop("motion") { (view: MotionView, curve: MotionCurveRecord?) in
        view.curve = curve ?? MotionCurveRecord()
      }

      OnViewDidUpdateProps { (view: MotionView) in
        view.apply()
      }
    }
  }
}
