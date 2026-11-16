import ArdiaBrowser
import Foundation
import WebKit

@MainActor
final class ResearchPageLoader {
  static let searchTimeout: Duration = .seconds(10)
  static let pageTimeout: Duration = .seconds(8)
  static let settle: Duration = .milliseconds(350)

  private let dataStore = WKWebsiteDataStore.nonPersistent()
  private let blocker: ContentBlocker?
  private let blockedResources = BlockedResourceCounter()

  init(blocker: ContentBlocker?) {
    self.blocker = blocker
  }

  func searchLinks(for query: String) async throws -> [ResearchLink] {
    guard let page = ResearchSearch.resultsPage(for: query) else { return [] }
    let webView = makeWebView()
    defer { webView.stopLoading() }
    try await load(page, in: webView, timeout: Self.searchTimeout)
    let html = try await webView.evaluateJavaScript("document.documentElement.outerHTML") as? String ?? ""
    return ResearchSearch.links(fromHTML: html)
  }

  func read(_ link: ResearchLink) async -> ReadableContent? {
    let webView = makeWebView()
    defer { webView.stopLoading() }
    do {
      try await load(link.url, in: webView, timeout: Self.pageTimeout)
      try await Task.sleep(for: Self.settle)
      return try await ReadableContent.extract(from: webView)
    } catch {
      return nil
    }
  }

  private func makeWebView() -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = dataStore
    configuration.applicationNameForUserAgent = BrowserUserAgent.applicationName
    configuration.mediaTypesRequiringUserActionForPlayback = .all
    configuration.allowsInlineMediaPlayback = false
    configuration.defaultWebpagePreferences.preferredContentMode = .mobile
    blocker?.install(on: configuration.userContentController, counter: blockedResources)
    return WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: configuration)
  }

  private func load(_ url: URL, in webView: WKWebView, timeout: Duration) async throws {
    let waiter = PageLoadWaiter()
    webView.navigationDelegate = waiter
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
        waiter.continuation = continuation
        blocker?.prepareNavigation(of: webView.configuration.userContentController, toHost: url.host(), isPrivate: true)
        webView.load(URLRequest(url: url, timeoutInterval: timeout.seconds))
        Task { @MainActor [weak waiter] in
          try? await Task.sleep(for: timeout)
          waiter?.finish(nil)
        }
      }
    } onCancel: {
      Task { @MainActor in waiter.finish(CancellationError()) }
    }
    webView.navigationDelegate = nil
  }
}

@MainActor
private final class PageLoadWaiter: NSObject, WKNavigationDelegate {
  var continuation: CheckedContinuation<Void, Error>?

  func finish(_ error: Error?) {
    guard let continuation else { return }
    self.continuation = nil
    if let error { continuation.resume(throwing: error) } else { continuation.resume() }
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    finish(nil)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    failUnlessReplaced(error)
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    failUnlessReplaced(error)
  }

  private func failUnlessReplaced(_ error: Error) {
    let error = error as NSError
    let replaced = (error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled) || (error.domain == WKError.errorDomain && error.code == 102)
    if !replaced { finish(error) }
  }

  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
    guard let scheme = navigationAction.request.url?.scheme?.lowercased() else { return .cancel }
    return scheme == "https" || scheme == "http" || scheme == "about" ? .allow : .cancel
  }
}

private extension Duration {
  var seconds: TimeInterval {
    let parts = components
    return TimeInterval(parts.seconds) + TimeInterval(parts.attoseconds) / 1e18
  }
}
