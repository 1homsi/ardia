#ifndef ARDIA_LINUX_AC_LINUX_WINDOW_COMMANDS_H_
#define ARDIA_LINUX_AC_LINUX_WINDOW_COMMANDS_H_

#include <optional>
#include <string_view>

namespace ardia::linux_commands {

inline constexpr char kToggleFullScreenCall[] = "ArdiaShell.toggleFullScreen";
inline constexpr char kEditCapability[] = "tab.edit";
inline constexpr char kEditCommand[] = "edit";
inline constexpr char kReadTextCall[] = "ArdiaShell.readText";
inline constexpr const char* kWindowCommandCapabilities[] = {"ArdiaShell.toggleFullScreen", "tab.edit",
                                                             "ArdiaShell.readText"};
inline constexpr char kResignActiveEvent[] = "resignActive";
inline constexpr int kAppActivationSettleMs = 150;

enum class EditAction { kUndo, kRedo, kCut, kCopy, kPaste, kPasteAndMatchStyle, kSelectAll };

struct EditName {
  std::string_view name;
  EditAction action;
};

inline constexpr EditName kEditActions[] = {
    {"undo", EditAction::kUndo},
    {"redo", EditAction::kRedo},
    {"cut", EditAction::kCut},
    {"copy", EditAction::kCopy},
    {"paste", EditAction::kPaste},
    {"pasteAndMatchStyle", EditAction::kPasteAndMatchStyle},
    {"selectAll", EditAction::kSelectAll},
};

constexpr std::optional<EditAction> ParseEditAction(std::string_view name) {
  for (const EditName& known : kEditActions) {
    if (known.name == name) return known.action;
  }
  return std::nullopt;
}

constexpr bool FullScreenAfterToggle(bool window_full_screen) {
  return !window_full_screen;
}

struct PageEscape {
  bool escape = false;
  bool control = false;
  bool alt = false;
  bool command = false;
  bool page_focused = false;
  bool page_visible = false;
};

constexpr bool SendsPageEscape(const PageEscape& press) {
  return press.escape && !press.control && !press.alt && !press.command && press.page_focused &&
         press.page_visible;
}

class AppActivation {
 public:
  constexpr bool Settle(bool any_window_active, bool modal_showing) {
    if (any_window_active) {
      active_ = true;
      return false;
    }
    if (!active_ || modal_showing) return false;
    active_ = false;
    return true;
  }
  constexpr bool active() const { return active_; }

 private:
  bool active_ = false;
};

}

#endif
