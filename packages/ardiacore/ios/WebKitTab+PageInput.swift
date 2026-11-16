import AppKit
import WebKit

extension WebKitTab {
  func listen(to view: WebKitWebView) {
    view.onFocus = { [weak self] in self?.pageFocused() }
    view.onPressRefused = { [weak self] in self?.pagePressRefused() }
  }

  func stopListening(to view: WebKitWebView) {
    view.onFocus = nil
    view.onPressRefused = nil
  }

  func takeFocusWhenShown(tries: Int = 20) {
    DispatchQueue.main.asyncAfter(deadline: .now() + (tries == 20 ? 0 : 0.05)) { [weak self] in
      guard let self, self.visible, let view = self.webView, let window = view.window else { return }
      let responder = window.firstResponder
      let waiting = view.isHiddenOrHasHiddenAncestor || Self.isOtherPage(responder, than: view)
      if waiting { return tries > 0 ? self.takeFocusWhenShown(tries: tries - 1) : () }
      guard responder == nil || responder === window || (responder as? NSView)?.isHiddenOrHasHiddenAncestor == true else { return }
      window.makeFirstResponder(view)
    }
  }

  private static func isOtherPage(_ responder: NSResponder?, than view: NSView) -> Bool {
    guard let held = responder as? NSView, held !== view, !held.isDescendant(of: view), !held.isHiddenOrHasHiddenAncestor else { return false }
    return held is WKWebView || String(describing: type(of: held)) == "RenderWidgetHostViewCocoa"
  }

  private func pageFocused() { emit("focus") }

  private func pagePressRefused() { emit("pagePress", ["refused": true]) }
}
