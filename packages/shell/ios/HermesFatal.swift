import Foundation

public enum HermesFatal {
  private static let name = "hermes-fatal.txt"
  private static let longest = 200
  private static let window: TimeInterval = 120

  public static func install() {
    guard let url = try? DocumentStore.url(name) else { return }
    ArdiaHermesFatalInstall(url.path)
  }

  static func take(crashedAt crashed: Date) -> String? {
    guard let url = try? DocumentStore.url(name),
      let written = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date else { return nil }
    let distance = written.timeIntervalSince(crashed)
    if distance > window { return nil }
    let data = try? Data(contentsOf: url)
    try? FileManager.default.removeItem(at: url)
    guard distance >= -window, let data else { return nil }
    let text = String(decoding: data.prefix(longest * 4), as: UTF8.self)
    let line = text.split(whereSeparator: \.isNewline).first.map { String($0.prefix(longest)).trimmingCharacters(in: .whitespaces) } ?? ""
    return line.isEmpty ? nil : line
  }
}
