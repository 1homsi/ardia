import ArdiaBrowser
import AVFoundation
import SwiftUI

enum ReadingVoices {
  static let enabledKey = "ArdiaReadAloud"
  static let chosenKey = "ArdiaReadingVoice"
  static let downloadTip = String(localized: "For a more natural voice, download an Enhanced or Premium one in Settings › Accessibility › Read & Speak › Voices. iOS doesn’t let apps download them for you.")

  static var language: String { AVSpeechSynthesisVoice.currentLanguageCode() }

  static func choices() -> [VoiceCandidate] {
    let installed = AVSpeechSynthesisVoice.speechVoices()
      .filter { !$0.voiceTraits.contains(.isNoveltyVoice) && !$0.identifier.contains(".eloquence.") && !$0.identifier.hasPrefix("com.apple.speech.synthesis.voice.") }
      .map { VoiceCandidate(id: $0.identifier, name: $0.name, language: $0.language, quality: quality(of: $0)) }
    return VoiceRanking.choices(from: installed, language: language)
  }

  static var hasNaturalVoice: Bool {
    VoiceRanking.best(among: choices()) != nil
  }

  static func automatic() -> AVSpeechSynthesisVoice? {
    if let best = VoiceRanking.best(among: choices()), let voice = AVSpeechSynthesisVoice(identifier: best.id) { return voice }
    return AVSpeechSynthesisVoice(language: language)
  }

  static func current(defaults: UserDefaults = .standard) -> AVSpeechSynthesisVoice? {
    if let id = defaults.string(forKey: chosenKey), !id.isEmpty, let voice = AVSpeechSynthesisVoice(identifier: id) { return voice }
    return automatic()
  }

  static func label(for voice: VoiceCandidate) -> String {
    guard voice.language != language, let region = Locale(identifier: voice.language).region?.identifier,
          let place = Locale.current.localizedString(forRegionCode: region) else { return voice.name }
    return String(localized: "\(voice.name), \(place)")
  }

  private static func quality(of voice: AVSpeechSynthesisVoice) -> VoiceCandidate.Quality {
    switch voice.quality {
    case .premium: .premium
    case .enhanced: .enhanced
    default: .standard
    }
  }
}

struct VoicePicker: View {
  var onChange: () -> Void = {}

  @AppStorage(ReadingVoices.chosenKey) private var chosen = ""

  var body: some View {
    let choices = ReadingVoices.choices()
    let selection = Binding(
      get: { choices.contains { $0.id == chosen } ? chosen : "" },
      set: { chosen = $0 }
    )
    Picker("Voice", selection: selection) {
      Text(automaticTitle).tag("")
      ForEach(choices) { voice in
        Text(ReadingVoices.label(for: voice)).tag(voice.id)
      }
    }
    .onChange(of: chosen) { onChange() }
  }

  private var automaticTitle: String {
    guard let voice = ReadingVoices.automatic() else { return String(localized: "Best Available") }
    return String(localized: "Best Available (\(voice.name))")
  }
}
