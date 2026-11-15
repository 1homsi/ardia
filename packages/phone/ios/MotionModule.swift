import ExpoModulesCore
import QuartzCore
import UIKit

struct MotionTargetRecord: Record {
  @Field var opacity: Double = 1
  @Field var translateX: Double = 0
  @Field var translateY: Double = 0
  @Field var scale: Double = 1

  var values: MotionValues {
    MotionValues(opacity: CGFloat(opacity), translateX: CGFloat(translateX), translateY: CGFloat(translateY), scale: CGFloat(scale))
  }
}

struct MotionCurveRecord: Record {
  @Field var type: String = "timing"
  @Field var durationMs: Double = 200
  @Field var curve: [Double]? = nil
  @Field var response: Double = 0.26
  @Field var dampingFraction: Double = 1

  var motion: MotionCurve {
    type == "spring"
      ? .spring(response: response, dampingFraction: dampingFraction)
      : .timing(seconds: durationMs / 1000, controlPoints: curve.map { $0.map(Float.init) })
  }
}

final class MotionView: ExpoView {
  let onMotionEnd = EventDispatcher()
  var target = MotionTargetRecord()
  var curve = MotionCurveRecord()
  private lazy var runner: MotionRunner = {
    let made = MotionRunner(layer: layer)
    made.onEnd = { [weak self] finished in self?.onMotionEnd(["finished": finished]) }
    return made
  }()

  func apply() {
    runner.show(target.values, curve: curve.motion, animates: window != nil && !UIAccessibility.isReduceMotionEnabled)
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
