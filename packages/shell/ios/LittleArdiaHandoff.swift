import AppKit
import ArdiaCore
import ObjectiveC

final class LittleArdiaHandoff {
  static let shared = LittleArdiaHandoff()

  private static let openerWindow: TimeInterval = 3
  private static let launchSettleTime: TimeInterval = 2
  private var lastOtherApp: NSRunningApplication?
  private var openerSeenAt = Date.distantPast
  private var appLinkOpenedAt = Date.distantPast
  private var returnApps: [String: NSRunningApplication] = [:]
  private var started = false

  func start() {
    guard !started else { return }
    started = true
    watchAppLinks()
    note(NSWorkspace.shared.frontmostApplication)
    NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) {
      [weak self] note in
      self?.note(note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)
    }
    NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
      self?.openerSeenAt = Date()
    }
  }

  func linkCame(from bundleId: String?) {
    guard let bundleId, bundleId != Bundle.main.bundleIdentifier,
      let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first(where: { $0.activationPolicy == .regular })
    else { return }
    lastOtherApp = app
    openerSeenAt = Date()
  }

  func opened(_ id: String) {
    let front = NSWorkspace.shared.frontmostApplication
    let cameFrom = front != nil && front != NSRunningApplication.current
      ? front
      : Date().timeIntervalSince(openerSeenAt) < Self.openerWindow ? lastOtherApp : nil
    returnApps[id] = cameFrom?.activationPolicy == .regular ? cameFrom : nil
  }

  func forget(_ id: String) {
    returnApps[id] = nil
  }

  func closing(_ id: String, replacedBy replacement: String?, keyWindow: Bool) {
    guard let app = returnApps.removeValue(forKey: id) else { return }
    if let replacement, replacement != id { return returnApps[replacement] = app }
    guard keyWindow, NSApp.isActive, !app.isTerminated,
      Date().timeIntervalSince(appLinkOpenedAt) > Self.launchSettleTime
    else { return }
    if LaunchConfig.shared.background {
      NSLog("[littleArdia] closing returns to %@ (background mode, not activated)", app.bundleIdentifier ?? "")
    } else if !app.activate(from: NSRunningApplication.current) {
      return
    }
    ShellEvents.send(.app, ["type": "littleArdiaReturnedToApp"])
  }

  private func note(_ app: NSRunningApplication?) {
    guard let app, app != NSRunningApplication.current, app.activationPolicy == .regular else { return }
    lastOtherApp = app
  }

  private func isAppLink(_ url: URL) -> Bool {
    guard let scheme = url.scheme?.lowercased() else { return false }
    return !["http", "https", "file"].contains(scheme)
  }

  private func appLinkLaunched(from little: String?) {
    appLinkOpenedAt = Date()
    ShellEvents.send(.app, ["type": "appLinkOpened", "windowId": little ?? NSNull()])
  }

  private func watchAppLinks() {
    let selector = #selector(NSWorkspace.open(_:configuration:completionHandler:))
    guard let method = class_getInstanceMethod(NSWorkspace.self, selector) else { return }
    typealias Open = @convention(c) (NSWorkspace, Selector, URL, NSWorkspace.OpenConfiguration, ((NSRunningApplication?, Error?) -> Void)?) -> Void
    let original = unsafeBitCast(method_getImplementation(method), to: Open.self)
    let block: @convention(block) (NSWorkspace, URL, NSWorkspace.OpenConfiguration, ((NSRunningApplication?, Error?) -> Void)?) -> Void = {
      workspace, url, configuration, done in
      let handoff = LittleArdiaHandoff.shared
      guard handoff.isAppLink(url) else { return original(workspace, selector, url, configuration, done) }
      let little = WindowManager.shared.keyWindowKind == .small ? WindowManager.shared.keyWindowId : nil
      if LaunchConfig.shared.background {
        NSLog("[littleArdia] app link %@: (background mode, not opened)", url.scheme ?? "")
        return handoff.appLinkLaunched(from: little)
      }
      original(workspace, selector, url, configuration) { app, error in
        if error == nil { DispatchQueue.main.async { handoff.appLinkLaunched(from: little) } }
        done?(app, error)
      }
    }
    method_setImplementation(method, imp_implementationWithBlock(block))
  }
}
