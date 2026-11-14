import ArdiaBrowser
import ArdiaDesign
import SwiftUI
import UIKit

struct OmniboxTextField: UIViewRepresentable {
  @Binding var text: String
  @Binding var isFocused: Bool
  var completion: CompletionOffer?
  var placeholder: String
  var isIncognito: Bool
  var selectsAllOnFocus: Bool
  var onSubmit: (String) -> Void

  func makeCoordinator() -> Coordinator {
    Coordinator(parent: self)
  }

  func makeUIView(context: Context) -> OmniboxField {
    let field = OmniboxField()
    field.clipsToBounds = true
    context.coordinator.editing.attach(field)
    field.keyboardType = .webSearch
    field.returnKeyType = .go
    field.autocorrectionType = .no
    field.autocapitalizationType = .none
    field.spellCheckingType = .no
    field.smartQuotesType = .no
    field.smartDashesType = .no
    field.enablesReturnKeyAutomatically = true
    field.clearButtonMode = .never
    field.adjustsFontForContentSizeCategory = true
    field.font = UIFontMetrics(forTextStyle: .title3).scaledFont(for: .systemFont(ofSize: 20))
    field.setContentHuggingPriority(.defaultLow, for: .horizontal)
    field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    field.accessibilityLabel = String(localized: "Search or Enter Address")
    field.text = text
    apply(to: field)
    return field
  }

  func updateUIView(_ field: OmniboxField, context: Context) {
    let coordinator = context.coordinator
    coordinator.parent = self
    coordinator.editing.selectsAllOnFocus = selectsAllOnFocus
    apply(to: field)
    if field.markedTextRange == nil, coordinator.echo.isExternal(text, current: field.editor.typed) {
      field.reset(to: text)
    }
    coordinator.editing.offer(completion, to: field)
    field.wantsFocus = isFocused
    if isFocused, !field.isFirstResponder, field.window != nil {
      DispatchQueue.main.async {
        guard self.isFocused, !field.isFirstResponder else { return }
        field.becomeFirstResponder()
      }
    } else if !isFocused, field.isFirstResponder {
      field.resignFirstResponder()
    }
  }

  private func apply(to field: OmniboxField) {
    let placeholderStyle = PlaceholderStyle(text: isFocused ? placeholder : "", isIncognito: isIncognito)
    if field.placeholderStyle != placeholderStyle {
      field.placeholderStyle = placeholderStyle
      let placeholderColor = isIncognito ? UIColor.white.withAlphaComponent(0.45) : UIColor(BrowsePalette.foregroundTertiary)
      field.attributedPlaceholder = placeholderStyle.text.isEmpty
        ? nil
        : NSAttributedString(string: placeholderStyle.text, attributes: [.foregroundColor: placeholderColor])
    }
    field.textColor = isIncognito ? .white : UIColor(BrowsePalette.foregroundPrimary)
    field.tintColor = UIColor(BrowsePalette.searchAccent)
    field.completionColor = UIColor(BrowsePalette.searchAccent).withAlphaComponent(0.3)
    field.keyboardAppearance = isIncognito ? .dark : .default
  }

  @MainActor
  final class Coordinator {
    var parent: OmniboxTextField
    var echo = BindingEchoFilter()
    let editing = CompletingFieldEditing()

    init(parent: OmniboxTextField) {
      self.parent = parent
      editing.onTyped = { [weak self] value in
        guard let self else { return }
        self.echo.pushed(value)
        self.parent.text = value
      }
      editing.onSubmit = { [weak self] submitted in self?.parent.onSubmit(submitted) }
      editing.onFocusChange = { [weak self] focused in
        guard let self, self.parent.isFocused != focused else { return }
        self.parent.isFocused = focused
      }
    }
  }
}

struct PlaceholderStyle: Equatable {
  let text: String
  let isIncognito: Bool
}

final class OmniboxField: CompletingTextField {
  var placeholderStyle: PlaceholderStyle?
}
