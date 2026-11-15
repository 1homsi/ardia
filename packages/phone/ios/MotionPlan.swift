import Foundation
import QuartzCore

struct MotionValues: Equatable {
  var opacity: CGFloat = 1
  var translateX: CGFloat = 0
  var translateY: CGFloat = 0
  var scale: CGFloat = 1

  init(opacity: CGFloat = 1, translateX: CGFloat = 0, translateY: CGFloat = 0, scale: CGFloat = 1) {
    self.opacity = min(max(opacity, 0), 1)
    self.translateX = translateX
    self.translateY = translateY
    self.scale = scale
  }

  init(showing layer: CALayer) {
    opacity = CGFloat(layer.opacity)
    translateX = (layer.value(forKeyPath: "transform.translation.x") as? CGFloat) ?? 0
    translateY = (layer.value(forKeyPath: "transform.translation.y") as? CGFloat) ?? 0
    scale = (layer.value(forKeyPath: "transform.scale.x") as? CGFloat) ?? 1
  }

  var transform: CATransform3D {
    CATransform3DScale(CATransform3DMakeTranslation(translateX, translateY, 0), scale, scale, 1)
  }

  func value(_ channel: MotionChannel) -> CGFloat {
    switch channel {
    case .opacity: opacity
    case .translateX: translateX
    case .translateY: translateY
    case .scale: scale
    }
  }
}

enum MotionChannel: CaseIterable {
  case opacity, translateX, translateY, scale

  var keyPath: String {
    switch self {
    case .opacity: "opacity"
    case .translateX: "transform.translation.x"
    case .translateY: "transform.translation.y"
    case .scale: "transform.scale"
    }
  }

  var key: String { "ardia.motion.\(keyPath)" }
}

enum MotionCurve: Equatable {
  case timing(seconds: Double, controlPoints: [Float]?)
  case spring(response: Double, dampingFraction: Double)

  static let fallbackControlPoints: [Float] = [0, 0, 0.58, 1]

  func animation(_ channel: MotionChannel, from: CGFloat, to: CGFloat) -> CABasicAnimation {
    let made: CABasicAnimation
    switch self {
    case let .timing(seconds, points):
      made = CABasicAnimation(keyPath: channel.keyPath)
      made.duration = max(seconds, 0)
      let curve = points?.count == 4 ? points! : Self.fallbackControlPoints
      made.timingFunction = CAMediaTimingFunction(controlPoints: curve[0], curve[1], curve[2], curve[3])
    case let .spring(response, dampingFraction):
      let spring = CASpringAnimation(perceptualDuration: max(response, 0.01), bounce: max(min(1 - dampingFraction, 1), -1))
      spring.keyPath = channel.keyPath
      spring.duration = spring.settlingDuration
      made = spring
    }
    made.fromValue = from
    made.toValue = to
    made.isRemovedOnCompletion = true
    return made
  }
}

final class MotionStop: NSObject, CAAnimationDelegate {
  weak var runner: MotionRunner?
  let move: Int

  init(runner: MotionRunner, move: Int) {
    self.runner = runner
    self.move = move
  }

  func animationDidStop(_ animation: CAAnimation, finished: Bool) {
    runner?.stopped(move: move, finished: finished)
  }
}

final class MotionRunner {
  let layer: CALayer
  var onEnd: ((Bool) -> Void)?
  private(set) var shown: MotionValues?
  private(set) var move = 0
  private var waiting = 0
  private var allFinished = true

  init(layer: CALayer) {
    self.layer = layer
  }

  func show(_ next: MotionValues, curve: MotionCurve, animates: Bool) {
    guard next != shown else { return }
    let from = shown.map { _ in MotionValues(showing: layer.presentation() ?? layer) }
    shown = next
    move += 1
    waiting = 0
    allFinished = true
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    for channel in MotionChannel.allCases {
      let start = from?.value(channel) ?? next.value(channel)
      let end = next.value(channel)
      guard animates, from != nil, abs(start - end) > 0.0001 else {
        layer.removeAnimation(forKey: channel.key)
        continue
      }
      let animation = curve.animation(channel, from: start, to: end)
      animation.delegate = MotionStop(runner: self, move: move)
      waiting += 1
      layer.add(animation, forKey: channel.key)
    }
    layer.opacity = Float(next.opacity)
    layer.transform = next.transform
    CATransaction.commit()
    if from != nil, waiting == 0 { onEnd?(true) }
  }

  func stopped(move stoppedMove: Int, finished: Bool) {
    guard stoppedMove == move, waiting > 0 else { return }
    waiting -= 1
    allFinished = allFinished && finished
    if waiting == 0 { onEnd?(allFinished) }
  }
}
