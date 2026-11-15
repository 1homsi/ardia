import ArdiaDesign
import SwiftUI
import UIKit

@MainActor
final class TrayEmergence {
  let pill: CGRect
  let fieldCenter: CGFloat
  private let mask = UIView()
  private let cardLens = UIView()
  private let fieldLens = UIView()
  private let shadowLens = UIView()
  private let face: UIView?
  private var isOpening = false

  static let faceFade = Motion.trayFaceFade
  static let faceLead: TimeInterval = 0.04
  static let shadowRoom: CGFloat = 18
  static let fieldClearance: CGFloat = 1
  static let settlePoll: Duration = .milliseconds(16)
  static let settleDeadline: Duration = .seconds(1)

  init(pill: CGRect, fieldCenter: CGFloat, face: UIView?, on tray: UIView) {
    self.pill = pill
    self.fieldCenter = fieldCenter
    self.face = face
    mask.backgroundColor = .clear
    for lens in [shadowLens, cardLens, fieldLens] {
      lens.backgroundColor = .black
      lens.layer.cornerCurve = .continuous
      mask.addSubview(lens)
    }
    shadowLens.alpha = 0
    tray.mask = mask
    if let face { tray.addSubview(face) }
  }

  func restingOffset(trayHeight: CGFloat, stageBottom: CGFloat) -> CGFloat {
    pill.midY - fieldCenter + trayHeight - stageBottom
  }

  func place(on tray: UIView, in stage: UIView, card: CGRect, isOpen: Bool) {
    let closed = stage.convert(pill, to: tray)
    let cardWindow = isOpen ? card : closed
    let field = isOpen ? fieldFrame(in: card) : closed
    let before = (card: cardLens.frame, field: fieldLens.frame, radius: cardLens.layer.cornerRadius)
    UIView.performWithoutAnimation {
      mask.frame = tray.bounds
      cardLens.frame = cardWindow
      cardLens.layer.cornerRadius = isOpen ? BrowseLayout.panelRadius : closed.height / 2
      fieldLens.frame = field
      fieldLens.layer.cornerRadius = field.height / 2
      shadowLens.frame = card.insetBy(dx: -Self.shadowRoom, dy: -Self.shadowRoom)
      shadowLens.layer.cornerRadius = BrowseLayout.panelRadius + Self.shadowRoom
      face?.center = CGPoint(x: card.midX, y: fieldCenter)
    }
    guard isOpen, !isOpening else { return }
    isOpening = true
    unfold(card: (before.card, cardWindow), field: (before.field, field), radius: (before.radius, cardLens.layer.cornerRadius))
  }

  private func fieldFrame(in card: CGRect) -> CGRect {
    let height = 2 * (fieldCenter - BrowseLayout.panelFieldInset) + 2 * Self.fieldClearance
    return CGRect(
      x: card.minX + BrowseLayout.panelFieldInset - Self.fieldClearance,
      y: fieldCenter - height / 2,
      width: card.width - 2 * BrowseLayout.panelFieldInset + 2 * Self.fieldClearance,
      height: height
    )
  }

  func fadeFace(from base: CFTimeInterval) {
    guard let face, face.layer.opacity > 0 else { return }
    face.fade(to: 0, after: Motion.trayRevealFieldDelay - Self.faceLead, from: base, curve: Self.faceFade)
  }

  private func unfold(card: (CGRect, CGRect), field: (CGRect, CGRect), radius: (CGFloat, CGFloat)) {
    let needed = card.1.width > card.0.width ? (field.1.width - card.0.width) / (card.1.width - card.0.width) : 0
    let deepenAt = Motion.trayOpenWiden.time(toReach: needed)
    Self.group(on: fieldLens.layer, [
      Self.spring("bounds.size.width", field.0.width, field.1.width, on: Motion.trayOpenWiden),
      Self.spring("position.x", field.0.midX, field.1.midX, on: Motion.trayOpenWiden),
      Self.spring("bounds.size.height", field.0.height, field.1.height, on: Motion.trayOpenWiden),
      Self.spring("position.y", field.0.midY, field.1.midY, on: Motion.trayOpenWiden),
      Self.spring("cornerRadius", field.0.height / 2, field.1.height / 2, on: Motion.trayOpenWiden),
    ])
    Self.group(on: cardLens.layer, [
      Self.spring("bounds.size.width", card.0.width, card.1.width, on: Motion.trayOpenWiden),
      Self.spring("position.x", card.0.midX, card.1.midX, on: Motion.trayOpenWiden),
      Self.spring("bounds.size.height", card.0.height, card.1.height, on: Motion.trayDeepen, after: deepenAt),
      Self.spring("position.y", card.0.midY, card.1.midY, on: Motion.trayDeepen, after: deepenAt),
      Self.capsuleRadius(heights: (card.0.height, card.1.height), cap: radius.1, on: Motion.trayDeepen, after: deepenAt),
    ])
    let shadowFade = CABasicAnimation(keyPath: "opacity")
    shadowFade.fromValue = 0
    shadowFade.toValue = 1
    shadowFade.beginTime = deepenAt + Motion.trayDeepen.duration
    shadowFade.duration = Motion.trayShadowIn.duration
    shadowFade.timingFunction = CAMediaTimingFunction(controlPoints: Float(Motion.trayShadowIn.start.x), Float(Motion.trayShadowIn.start.y), Float(Motion.trayShadowIn.end.x), Float(Motion.trayShadowIn.end.y))
    shadowFade.fillMode = .backwards
    UIView.performWithoutAnimation { shadowLens.alpha = 1 }
    Self.group(on: shadowLens.layer, [shadowFade])
  }

  private static func spring(_ keyPath: String, _ from: CGFloat, _ to: CGFloat, on timing: Spring, after delay: CFTimeInterval = 0) -> CAAnimation {
    let spring = CASpringAnimation(perceptualDuration: timing.duration, bounce: timing.bounce)
    spring.keyPath = keyPath
    spring.fromValue = from
    spring.toValue = to
    spring.duration = spring.settlingDuration
    spring.beginTime = delay
    spring.fillMode = .backwards
    return spring
  }

  private static func capsuleRadius(heights: (CGFloat, CGFloat), cap: CGFloat, on timing: Spring, after delay: CFTimeInterval) -> CAAnimation {
    let steps = max(Int(timing.settlingDuration * 120), 2)
    let omega = 2 * Double.pi / timing.duration
    var values: [CGFloat] = []
    var keyTimes: [NSNumber] = []
    for step in 0...steps {
      let fraction = Double(step) / Double(steps)
      let t = fraction * timing.settlingDuration
      let progress = 1 - (1 + omega * t) * exp(-omega * t)
      let height = heights.0 + (heights.1 - heights.0) * CGFloat(progress)
      values.append(min(height / 2, cap))
      keyTimes.append(NSNumber(value: fraction))
    }
    let animation = CAKeyframeAnimation(keyPath: "cornerRadius")
    animation.values = values
    animation.keyTimes = keyTimes
    animation.calculationMode = .linear
    animation.duration = timing.settlingDuration
    animation.beginTime = delay
    animation.fillMode = .backwards
    return animation
  }

  private static func group(on layer: CALayer, _ animations: [CAAnimation]) {
    let group = CAAnimationGroup()
    group.animations = animations
    group.duration = animations.map { $0.beginTime + $0.duration }.max() ?? 0
    layer.add(group, forKey: "unfold")
  }

  func shownSurface(of tray: UIView, card: CGRect, in stage: UIView) -> TrayMorph.Start {
    let cardNow = (cardLens.layer.presentation() ?? cardLens.layer).frame
    let fieldNow = (fieldLens.layer.presentation() ?? fieldLens.layer).frame
    let shown = tray.layer.presentation() ?? tray.layer
    let window = cardNow.union(fieldNow).intersection(card)
    let frame = shown.convert(window.isNull ? card : window, to: stage.layer.presentation() ?? stage.layer)
    return TrayMorph.Start(frame: frame, radius: min(BrowseLayout.panelRadius, frame.height / 2))
  }

  var isSettled: Bool {
    let lensesIdle = [cardLens, fieldLens, shadowLens].allSatisfy { ($0.layer.animationKeys() ?? []).isEmpty }
    guard isOpening, lensesIdle else { return false }
    guard let face else { return true }
    return face.layer.opacity == 0 && (face.layer.animationKeys() ?? []).isEmpty
  }

  func end(on tray: UIView) {
    if tray.mask === mask { tray.mask = nil }
    face?.removeFromSuperview()
  }
}

extension Spring {
  static let fullyThere: CGFloat = 0.98

  func time(toReach progress: CGFloat) -> CFTimeInterval {
    let target = min(max(progress, 0), Self.fullyThere)
    guard target > 0 else { return 0 }
    let omega = 2 * Double.pi / duration
    var t = 0.0
    while t < settlingDuration {
      if 1 - (1 + omega * t) * exp(-omega * t) >= Double(target) { return t }
      t += 0.002
    }
    return settlingDuration
  }
}
