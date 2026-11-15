import ArdiaDesign
import UIKit

@MainActor
final class TrayEmergence {
  let pill: CGRect
  let fieldCenter: CGFloat
  private let lens = UIView()
  private let face: UIView?
  private var isOpening = false

  static let faceFade = MotionCurve(0.42, 0, 0.58, 1, duration: 0.16)
  static let shadowRoom: CGFloat = 18
  static let settlePoll: Duration = .milliseconds(16)
  static let settleDeadline: Duration = .seconds(1)

  init(pill: CGRect, fieldCenter: CGFloat, face: UIView?, on tray: UIView) {
    self.pill = pill
    self.fieldCenter = fieldCenter
    self.face = face
    lens.backgroundColor = .black
    lens.layer.cornerCurve = .continuous
    tray.mask = lens
    if let face {
      face.isUserInteractionEnabled = false
      face.layer.cornerRadius = pill.height / 2
      face.layer.cornerCurve = .continuous
      face.clipsToBounds = true
      tray.addSubview(face)
    }
  }

  func restingOffset(trayHeight: CGFloat, stageBottom: CGFloat) -> CGFloat {
    pill.midY - fieldCenter + trayHeight - stageBottom
  }

  func place(on tray: UIView, in stage: UIView, card: CGRect, isOpen: Bool) {
    let window = isOpen ? card.insetBy(dx: -Self.shadowRoom, dy: -Self.shadowRoom) : stage.convert(pill, to: tray)
    lens.frame = window
    lens.layer.cornerRadius = isOpen ? BrowseLayout.panelRadius + Self.shadowRoom : pill.height / 2
    face?.center = CGPoint(x: window.midX, y: window.midY)
    guard isOpen, !isOpening else { return }
    isOpening = true
    if let face {
      UIViewPropertyAnimator(duration: Self.faceFade.duration, controlPoint1: Self.faceFade.start, controlPoint2: Self.faceFade.end) {
        face.alpha = 0
      }.startAnimation()
    }
  }

  func shownSurface(of tray: UIView, card: CGRect, in stage: UIView) -> TrayMorph.Start {
    let lensNow = lens.layer.presentation() ?? lens.layer
    let shown = tray.layer.presentation() ?? tray.layer
    let window = lensNow.frame.intersection(card)
    let frame = shown.convert(window.isNull ? card : window, to: stage.layer.presentation() ?? stage.layer)
    return TrayMorph.Start(frame: frame, radius: min(lensNow.cornerRadius, BrowseLayout.panelRadius, frame.height / 2))
  }

  var isSettled: Bool {
    isOpening && (lens.layer.animationKeys() ?? []).isEmpty && (face?.layer.animationKeys() ?? []).isEmpty
  }

  func end(on tray: UIView) {
    if tray.mask === lens { tray.mask = nil }
    face?.removeFromSuperview()
  }
}
