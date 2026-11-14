#include <cassert>
#include <cstdio>
#include <set>
#include <string>

#include "ardia/linux/ac_linux_window_commands.h"

namespace commands = ardia::linux_commands;

int main() {
  using commands::EditAction;
  assert(commands::ParseEditAction("undo") == EditAction::kUndo);
  assert(commands::ParseEditAction("redo") == EditAction::kRedo);
  assert(commands::ParseEditAction("cut") == EditAction::kCut);
  assert(commands::ParseEditAction("copy") == EditAction::kCopy);
  assert(commands::ParseEditAction("paste") == EditAction::kPaste);
  assert(commands::ParseEditAction("pasteAndMatchStyle") == EditAction::kPasteAndMatchStyle);
  assert(commands::ParseEditAction("selectAll") == EditAction::kSelectAll);
  for (const char* unknown : {"", "Undo", "undo:", "std:undo:", "delete", "pasteandmatchstyle", " paste", "copy "}) {
    assert(!commands::ParseEditAction(unknown));
  }
  assert(!commands::ParseEditAction(std::string("undo\0", 5)));
  std::set<EditAction> actions;
  std::set<std::string> names;
  for (const commands::EditName& known : commands::kEditActions) {
    actions.insert(known.action);
    names.insert(std::string(known.name));
  }
  assert(actions.size() == 7 && names.size() == 7);
  assert(commands::FullScreenAfterToggle(false));
  assert(!commands::FullScreenAfterToggle(true));
  const commands::PageEscape plain{.escape = true, .page_focused = true, .page_visible = true};
  assert(commands::SendsPageEscape(plain));
  for (bool commands::PageEscape::*field : {&commands::PageEscape::control, &commands::PageEscape::alt,
                                              &commands::PageEscape::command}) {
    commands::PageEscape refused = plain;
    refused.*field = true;
    assert(!commands::SendsPageEscape(refused));
  }
  for (bool commands::PageEscape::*field : {&commands::PageEscape::escape, &commands::PageEscape::page_focused,
                                              &commands::PageEscape::page_visible}) {
    commands::PageEscape refused = plain;
    refused.*field = false;
    assert(!commands::SendsPageEscape(refused));
  }
  commands::AppActivation activation;
  assert(!activation.Settle(false, false));
  assert(!activation.Settle(true, false) && activation.active());
  assert(!activation.Settle(true, false));
  assert(!activation.Settle(false, true) && activation.active());
  assert(activation.Settle(false, false) && !activation.active());
  assert(!activation.Settle(false, false));
  assert(!activation.Settle(true, true) && activation.active());
  assert(activation.Settle(false, false));
  std::puts("ok");
  return 0;
}
