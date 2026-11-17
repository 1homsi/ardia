import Foundation

public struct VoiceCandidate: Equatable, Sendable, Identifiable {
  public enum Quality: Int, Sendable, Comparable {
    case standard
    case enhanced
    case premium

    public static func < (lhs: Quality, rhs: Quality) -> Bool { lhs.rawValue < rhs.rawValue }
  }

  public var id: String
  public var name: String
  public var language: String
  public var quality: Quality

  public init(id: String, name: String, language: String, quality: Quality) {
    self.id = id
    self.name = name
    self.language = language
    self.quality = quality
  }

  public var isNatural: Bool { quality != .standard }
}

public enum VoiceRanking {
  public static func family(of language: String) -> String {
    String(language.prefix { $0 != "-" && $0 != "_" }).lowercased()
  }

  public static func choices(from voices: [VoiceCandidate], language: String) -> [VoiceCandidate] {
    let family = family(of: language)
    return voices
      .filter { self.family(of: $0.language) == family }
      .sorted { first, second in
        if first.quality != second.quality { return first.quality > second.quality }
        let firstIsLocal = first.language == language
        if firstIsLocal != (second.language == language) { return firstIsLocal }
        return first.name.localizedStandardCompare(second.name) == .orderedAscending
      }
  }

  public static func best(among choices: [VoiceCandidate]) -> VoiceCandidate? {
    choices.first { $0.isNatural }
  }
}
