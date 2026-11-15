import ArdiaDesign
import ExpoModulesCore
import ExpoUI
import SwiftUI

enum SettingsTintChoice {
  static let swatch = "swatch"

  static func color(_ name: String, look: ProfileLook) -> Color {
    name == swatch ? look.swatchColor : (SettingsTint.named(name) ?? SettingsTint.neutral)
  }
}

struct TintedTile: View {
  var systemImage: String
  var tint: String
  var baseSide: CGFloat
  @Environment(\.profileLook) private var look

  var body: some View {
    SettingsIconTile(systemImage: systemImage, color: SettingsTintChoice.color(tint, look: look), baseSide: baseSide)
  }
}

final class SettingsIconTileProps: UIBaseViewProps {
  @Field var systemImage: String = "gearshape"
  @Field var tint: String = "neutral"
  @Field var baseSide: Double = Double(SettingsTile.side)
}

struct SettingsIconTileView: ExpoSwiftUI.View {
  @ObservedObject var props: SettingsIconTileProps

  var body: some View {
    TintedTile(systemImage: props.systemImage, tint: props.tint, baseSide: CGFloat(props.baseSide))
  }
}

final class SettingsRowLabelProps: UIBaseViewProps {
  @Field var title: String = ""
  @Field var systemImage: String = "gearshape"
  @Field var tint: String = "neutral"
}

struct SettingsRowLabelView: ExpoSwiftUI.View {
  @ObservedObject var props: SettingsRowLabelProps
  @Environment(\.profileLook) private var look

  var body: some View {
    SettingsRowLabel(LocalizedStringKey(props.title), systemImage: props.systemImage, tint: SettingsTintChoice.color(props.tint, look: look))
  }
}

final class SettingsHeroContentProps: UIBaseViewProps {
  @Field var title: String = ""
  @Field var subtitle: String = ""
  @Field var systemImage: String = "gearshape"
  @Field var tint: String = "neutral"
}

struct SettingsHeroContentView: ExpoSwiftUI.View {
  @ObservedObject var props: SettingsHeroContentProps
  @Environment(\.profileLook) private var look

  var body: some View {
    SettingsHeroContent(LocalizedStringKey(props.title), subtitle: Text(props.subtitle), systemImage: props.systemImage, tint: SettingsTintChoice.color(props.tint, look: look)) {
      Children()
    }
  }
}

final class SetupStepRowProps: UIBaseViewProps {
  @Field var number: Int = 1
  @Field var title: String = ""
  @Field var detail: String = ""
  @Field var progress: String = "upcoming"
}

struct SetupStepRowView: ExpoSwiftUI.View {
  @ObservedObject var props: SetupStepRowProps

  private var progress: SetupStepRow<AnyView>.Progress {
    switch props.progress {
    case "done": .done
    case "current": .current
    default: .upcoming
    }
  }

  var body: some View {
    SetupStepRow(props.number, title: Text(props.title), detail: Text(props.detail), progress: progress) {
      AnyView(Children())
    }
  }
}

final class ColorSwatchProps: UIBaseViewProps {
  @Field var preset: String = "plum"
  @Field var isSelected: Bool = false
}

struct ColorSwatchView: ExpoSwiftUI.View {
  @ObservedObject var props: ColorSwatchProps

  var body: some View {
    ColorSwatch(color: ProfileLook(preset: ProfileLook.Preset(rawValue: props.preset) ?? .plum).swatchColor, isSelected: props.isSelected)
  }
}

final class CheckmarkLabelProps: UIBaseViewProps {
  @Field var title: String = ""
  @Field var isChecked: Bool = false
}

struct CheckmarkLabelView: ExpoSwiftUI.View {
  @ObservedObject var props: CheckmarkLabelProps

  var body: some View {
    CheckmarkLabel(title: props.title, isChecked: props.isChecked)
  }
}

final class AppIconPreviewProps: UIBaseViewProps {
  @Field var side: Double = 29
}

struct AppIconPreviewView: ExpoSwiftUI.View {
  @ObservedObject var props: AppIconPreviewProps

  var body: some View {
    AppIconPreview(side: CGFloat(props.side))
  }
}

struct SettingsChromeModifier: ViewModifier, Record {
  func body(content: Content) -> some View {
    content.ardiaSettingsChrome()
  }
}

struct SettingsPageModifier: ViewModifier, Record {
  @Field var title: String = ""

  func body(content: Content) -> some View {
    content.ardiaSettingsPage(LocalizedStringKey(title))
  }
}

struct ChromeSurfaceModifier: ViewModifier, Record {
  @Field var shape: String = "capsule"
  @Field var cornerRadius: Double = 0
  @Field var interactive: Bool = true
  @Field var tinted: Bool = false

  @ViewBuilder
  func body(content: Content) -> some View {
    switch shape {
    case "circle": content.chromeSurface(in: Circle(), interactive: interactive, tinted: tinted)
    case "rounded": content.chromeSurface(in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous), interactive: interactive, tinted: tinted)
    default: content.chromeSurface(in: Capsule(), interactive: interactive, tinted: tinted)
    }
  }
}

struct SettingsSwitchStyleModifier: ViewModifier, Record {
  func body(content: Content) -> some View {
    content.toggleStyle(SettingsSwitchStyle())
  }
}

struct PressableStyleModifier: ViewModifier, Record {
  func body(content: Content) -> some View {
    content.buttonStyle(PressableStyle())
  }
}

struct LegibleInkModifier: ViewModifier, Record {
  @Field var tint: String = "green"

  func body(content: Content) -> some View {
    content.modifier(LegibleInkResolver(tint: tint))
  }
}

struct LegibleInkResolver: ViewModifier {
  var tint: String
  @Environment(\.profileLook) private var look

  func body(content: Content) -> some View {
    content.foregroundStyle(.ardiaInk(tint == "formAccent" ? Palette.formAccent : SettingsTintChoice.color(tint, look: look)))
  }
}

struct ContentMarginsModifier: ViewModifier, Record {
  @Field var edges: String = "top"
  @Field var length: Double = 0

  private var edgeSet: Edge.Set {
    switch edges {
    case "bottom": .bottom
    case "all": .all
    default: .top
    }
  }

  func body(content: Content) -> some View {
    content.contentMargins(edgeSet, CGFloat(length), for: .scrollContent)
  }
}

struct ProfileLookModifier: ViewModifier, Record {
  @Field var color: String? = nil
  @Field var themeColors: [String] = []
  @Field var darkThemeColors: [String]? = nil
  @Field var usesGlass: Bool = true

  func body(content: Content) -> some View {
    content
      .environment(\.profileLook, ProfileLook(colorName: color, themeColors: themeColors, darkThemeColors: darkThemeColors))
      .environment(\.usesGlass, usesGlass)
  }
}

enum SettingsUIModifiers {
  static let names = ["ardia.settingsChrome", "ardia.settingsPage", "ardia.chromeSurface", "ardia.settingsSwitchStyle", "ardia.pressableStyle", "ardia.legibleInk", "ardia.profileLook", "ardia.contentMargins"]

  static func register() {
    ViewModifierRegistry.register("ardia.settingsChrome") { params, context, _ in try SettingsChromeModifier(from: params, appContext: context) }
    ViewModifierRegistry.register("ardia.settingsPage") { params, context, _ in try SettingsPageModifier(from: params, appContext: context) }
    ViewModifierRegistry.register("ardia.chromeSurface") { params, context, _ in try ChromeSurfaceModifier(from: params, appContext: context) }
    ViewModifierRegistry.register("ardia.settingsSwitchStyle") { params, context, _ in try SettingsSwitchStyleModifier(from: params, appContext: context) }
    ViewModifierRegistry.register("ardia.pressableStyle") { params, context, _ in try PressableStyleModifier(from: params, appContext: context) }
    ViewModifierRegistry.register("ardia.legibleInk") { params, context, _ in try LegibleInkModifier(from: params, appContext: context) }
    ViewModifierRegistry.register("ardia.profileLook") { params, context, _ in try ProfileLookModifier(from: params, appContext: context) }
    ViewModifierRegistry.register("ardia.contentMargins") { params, context, _ in try ContentMarginsModifier(from: params, appContext: context) }
  }

  static func unregister() {
    for name in names { ViewModifierRegistry.unregister(name) }
  }
}

public final class SettingsUIModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaPhoneSettingsUI")

    OnCreate {
      SettingsUIModifiers.register()
    }

    OnDestroy {
      SettingsUIModifiers.unregister()
    }

    ExpoUIView(SettingsIconTileView.self)
    ExpoUIView(SettingsRowLabelView.self)
    ExpoUIView(SettingsHeroContentView.self)
    ExpoUIView(SetupStepRowView.self)
    ExpoUIView(ColorSwatchView.self)
    ExpoUIView(CheckmarkLabelView.self)
    ExpoUIView(AppIconPreviewView.self)
  }
}
