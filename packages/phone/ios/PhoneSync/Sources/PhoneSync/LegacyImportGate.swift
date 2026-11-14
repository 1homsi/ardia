import Foundation

public struct LegacyImportGate: Sendable {
  public enum Presence: Equatable, Sendable {
    case absent
    case present
    case unreadable
  }

  public struct Receipt: Codable, Equatable, Sendable {
    public var tabs: Int
    public var archive: Int
    public var visits: Int
    public var preferences: Int

    public init(tabs: Int, archive: Int, visits: Int, preferences: Int) {
      self.tabs = tabs
      self.archive = archive
      self.visits = visits
      self.preferences = preferences
    }
  }

  public struct Marker: Codable, Equatable, Sendable {
    public var version: Int
    public var importedAt: Double
    public var settingsApplied: Bool
    public var receipt: Receipt?
  }

  public enum MarkerState: Equatable, Sendable {
    case absent
    case valid(Marker)
    case invalid
  }

  public struct NotReady: Error, Sendable {
    public let reason: String
  }

  public static let markerVersion = 1

  public let legacyStores: [URL]
  public let marker: URL
  private let hasLegacyPreferences: @Sendable () -> Bool

  public init(legacyStores: [URL], marker: URL, hasLegacyPreferences: @escaping @Sendable () -> Bool = { false }) {
    self.legacyStores = legacyStores
    self.marker = marker
    self.hasLegacyPreferences = hasLegacyPreferences
  }

  public var storePresence: Presence {
    var unreadable = false
    for store in legacyStores {
      switch Self.presence(of: store) {
      case .present: return .present
      case .unreadable: unreadable = true
      case .absent: continue
      }
    }
    return unreadable ? .unreadable : .absent
  }

  public var hasLegacyStore: Bool { storePresence != .absent }

  public var hasLegacyData: Bool { hasLegacyStore || hasLegacyPreferences() }

  public var markerState: MarkerState {
    let data: Data
    do {
      data = try Data(contentsOf: marker)
    } catch {
      return Self.isMissing(error) ? .absent : .invalid
    }
    guard let decoded = try? JSONDecoder().decode(Marker.self, from: data),
          decoded.version == Self.markerVersion, decoded.settingsApplied, decoded.importedAt > 0
    else { return .invalid }
    return .valid(decoded)
  }

  public var imported: Bool {
    if case .valid = markerState { return true }
    return false
  }

  public var holdsSync: Bool { hasLegacyData && !imported }

  public func markImported(receipt: Receipt?, settingsApplied: Bool, at time: Date = .now) throws {
    guard settingsApplied else { throw NotReady(reason: "settings") }
    if imported { return }
    try FileManager.default.createDirectory(at: marker.deletingLastPathComponent(), withIntermediateDirectories: true)
    let record = Marker(version: Self.markerVersion, importedAt: (time.timeIntervalSince1970 * 1000).rounded(), settingsApplied: true, receipt: receipt)
    try JSONEncoder().encode(record).write(to: marker, options: .atomic)
    guard imported else { throw NotReady(reason: "marker") }
  }

  static func presence(of url: URL) -> Presence {
    do {
      _ = try FileManager.default.attributesOfItem(atPath: url.path(percentEncoded: false))
      return .present
    } catch {
      return isMissing(error) ? .absent : .unreadable
    }
  }

  static func isMissing(_ error: Error) -> Bool {
    let error = error as NSError
    if error.domain == NSCocoaErrorDomain, error.code == NSFileReadNoSuchFileError || error.code == NSFileNoSuchFileError { return true }
    if let underlying = error.userInfo[NSUnderlyingErrorKey] as? NSError, underlying.domain == NSPOSIXErrorDomain, underlying.code == Int(ENOENT) { return true }
    return error.domain == NSPOSIXErrorDomain && error.code == Int(ENOENT)
  }
}
