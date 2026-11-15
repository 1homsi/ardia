import AppKit
import ArdiaCore
import ObjectiveC

final class LittleArdiaHandoff {
  static let shared = LittleArdiaHandoff()

  private static let ignoredSchemes: Set<String> = ["http", "https", "file", "x-apple.systempreferences"]
  private var returnApps: [String: NSRunningApplication] = [:]
  private var started = false

  func start() {
    guard !started else { return }
    started = true
    watchAppLinks()
  }

  func opened(_ id: String, linkFrom bundleId: String?) {
    let linkApp = bundleId.flatMap { NSRunningApplication.runningApplications(withBundleIdentifier: $0).first }
    let cameFrom = linkApp ?? NSWorkspace.shared.frontmostApplication
    returnApps[id] = cameFrom?.activationPolicy == .regular && cameFrom != NSRunningApplication.current ? cameFrom : nil
  }

  func forget(_ id: String) {
    returnApps[id] = nil
  }

  func closing(_ id: String, replacedBy replacement: String?, keyWindow: Bool) {
    guard let app = returnApps.removeValue(forKey: id) else { return }
    if let replacement, replacement != id { return returnApps[replacement] = app }
    guard keyWindow, NSApp.isActive, !app.isTerminated else { return }
    if LaunchConfig.shared.background {
      NSLog("[littleArdia] closing returns to %@ (background mode, not activated)", app.bundleIdentifier ?? "")
    } else if !app.activate(from: NSRunningApplication.current) {
      return
    }
    ShellEvents.send(.app, ["type": "littleArdiaReturnedToApp"])
  }

  private func isAppLink(_ url: URL) -> Bool {
    guard let scheme = url.scheme?.lowercased() else { return false }
    return !Self.ignoredSchemes.contains(scheme)
  }

  private func appLinkLaunched(from little: String?) {
    if let little { returnApps[little] = nil }
    ShellEvents.send(.app, ["type": "appLinkOpened", "windowId": little ?? NSNull()])
  }

  private func keyLittleArdia() -> String? {
    guard Thread.isMainThread, WindowManager.shared.keyWindowKind == .small else { return nil }
    return WindowManager.shared.keyWindowId
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
      let little = handoff.keyLittleArdia()
      if LaunchConfig.shared.background {
        NSLog("[littleArdia] app link %@: (background mode, not opened)", url.scheme ?? "")
        DispatchQueue.main.async {
          handoff.appLinkLaunched(from: little)
          done?(nil, CocoaError(.userCancelled))
        }
        return
      }
      original(workspace, selector, url, configuration) { app, error in
        if error == nil { DispatchQueue.main.async { handoff.appLinkLaunched(from: little) } }
        done?(app, error)
      }
    }
    method_setImplementation(method, imp_implementationWithBlock(block))
  }
}
