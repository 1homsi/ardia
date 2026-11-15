import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock, test } from "node:test";
import { notePageAsked, notePageSettled, watchDialogsWith, windowsDialogPages } from "../../../../packages/expo-windows/src/engine/dialogPages.ts";
import { takeDialogPageCounts } from "../state/telemetry/dialogPageCounts.ts";

test("a page asked while a dialog is open counts, and stalls only if it hasn't loaded 10 s later", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let open = false;
    watchDialogsWith(() => open);
    windowsDialogPages.takeDialogPages();
    notePageAsked("no-dialog");
    open = true;
    notePageAsked("loads");
    notePageAsked("stalls");
    notePageAsked("closed");
    mock.timers.tick(4000);
    notePageSettled("loads");
    notePageSettled("closed");
    mock.timers.tick(6001);
    assert.deepEqual(windowsDialogPages.takeDialogPages(), { asked: 3, stalled: 1 });
    assert.deepEqual(windowsDialogPages.takeDialogPages(), { asked: 0, stalled: 0 });
    watchDialogsWith(() => {
      throw new Error("no native module");
    });
    notePageAsked("throws");
    assert.deepEqual(windowsDialogPages.takeDialogPages(), { asked: 0, stalled: 0 });
  } finally {
    mock.timers.reset();
  }
});

test("the hourly extras name the counts, and the Mac sends zeros", () => {
  assert.deepEqual(takeDialogPageCounts(), { dialog_pages_asked: 0, dialog_pages_stalled: 0 });
});

test("every native modal runs through RunModal off the UI thread, and the app stops them before the UI queue goes", () => {
  const native = (name) => readFileSync(new URL(`../../windows/Ardia/${name}`, import.meta.url), "utf8");
  const module = native("DialogsModule.h");
  for (const shown of ["ShowConfirm(owner, title", "ShowPrompt(owner,", "ShowOpenFiles(owner)", "ShowSaveFile(owner,", "ShowOpenFolder(owner,"]) {
    const at = module.indexOf(shown);
    assert.ok(at > 0, shown);
    assert.ok(module.lastIndexOf("DialogParts::RunModal(owner,", at) > module.lastIndexOf("REACT_METHOD(", at), `${shown} isn't inside RunModal`);
  }
  for (const [file, count] of [["NativeDialogs.h", 4], ["SaveDialog.h", 1]]) {
    assert.equal(native(file).split("ModalOverWindow modal(owner,").length - 1, count, file);
    const shown = native(file).split("ModalOverWindow modal(owner,").slice(1);
    for (const body of shown) assert.match(body.split(/\n\}\n/)[0], /ModalWatch::OnAbandon\(|FileDialogWatch watch\(/, `${file}: a dialog with nothing to cancel it at quit`);
  }
  assert.match(module, /  ModalWatch watch;\n  OpenDialogScope open;\n  HeldPageWindows pages;\n  ModalParent parent;\n\};/);
  for (const file of ["NativeDialogs.h", "SaveDialog.h"]) {
    const source = native(file);
    for (const call of [/hwndParent = (\w+)/g, /MessageBoxW\((\w+)/g, /builder\.words\.data\(\)\), (\w+(?:\.Parent\(\))?)/g, /->Show\(([\w.()]+)\)/g]) {
      for (const [, parent] of source.matchAll(call)) assert.ok(parent.startsWith("modal"), `${file} gives ${parent} to a dialog: a window on another thread must never own it`);
    }
  }
  assert.match(module, /ModalWatch::OnTick\(\[this\] \{\n      pages\.Refresh\(\);\n      parent\.KeepDialogAboveOwner\(\);\n    \}\);/);
  assert.match(native("ModalThread.h"), /SetThreadDpiAwarenessContext\(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2\);/);
  const windows = native("WindowManager.h");
  assert.match(windows, /if \(message == WM_ACTIVATE && LOWORD\(wParam\) != WA_INACTIVE && DialogParts::BringModalForward\(hwnd\)\) return 0;/);
  assert.match(windows, /if \(!DialogParts::BringModalForward\(entry->hwnd\)\) SetForegroundWindow\(entry->hwnd\);/);
  assert.match(native("NativeDialogs.h"), /else if \(HWND fallback = modal\.parent\.Dialog\(\)\) PostMessageW\(fallback, WM_COMMAND, IDCANCEL, 0\);/);
  assert.match(native("Ardia.cpp"), /void ArdiaAppStop\(void\) \{\n  int dialogsOpen = Ardia::DialogParts::ModalRegistry::Shared\(\)\.threads\.load\(\);\n  int waited = Ardia::DialogParts::StopAllModals\(\);/);
  assert.match(native("ModalThread.h"), /while \(registry\.threads\.load\(\) > 0 && GetTickCount64\(\) - began < StopWaitMs\) DeliverSentMessages\(10\);/);
  assert.match(native("ModalThread.h"), /PeekMessageW\(&message, nullptr, 0, 0, PM_NOREMOVE \| PM_QS_SENDMESSAGE\);/);
  assert.match(native("Ardia.cpp"), /host\.engine = nullptr;\n  SetFocus\(nullptr\);\n  if \(host\.queue\) host\.queue\.ShutdownQueue\(\);/);
  assert.match(module, /parent\(owner, !Background\(\)\)/);
  const thread = native("ModalThread.h");
  assert.match(thread, /!m_ownerWasEnabled \|\| Stopping\(\)\) return;\n    bool hadFocus = m_givesFocusBack && DialogInFront\(\);/);
  assert.doesNotMatch(thread, /OursInFront/);
  assert.match(module, /void Release\(\) noexcept \{\n    if \(Stopping\(\)\) \{\n      m_pages\.clear\(\);\n      return;\n    \}/);
});

test("a file dialog cancelled at quit closes through Close and, if still open, through its own window, and says how long it took", () => {
  const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const native = (name) => readFileSync(new URL(`../../windows/Ardia/${name}`, import.meta.url), "utf8");
  const dialogs = native("NativeDialogs.h");
  assert.match(dialogs, /NoteCancel\(timing\.kind, L"cancelled \(Close: " \+ HexResult\(dialog->Close\(HRESULT_FROM_WIN32\(ERROR_CANCELLED\)\)\) \+ L"\)"\);\n\s+ModalWatch::OnStubborn\(/);
  assert.match(dialogs, /timing\.byWindow = window && PostMessageW\(window, WM_COMMAND, IDCANCEL, 0\);/);
  assert.match(dialogs, /L"closed " \+ std::to_wstring\(GetTickCount64\(\) - cancelledAt\) \+ L" ms after its cancel"/);
  for (const [file, kind] of [["NativeDialogs.h", "file picker"], ["NativeDialogs.h", "folder picker"], ["SaveDialog.h", "save panel"]]) assert.ok(native(file).includes(`FileDialogWatch watch(dialog.get(), "${kind}");`), kind);
  const thread = native("ModalThread.h");
  assert.match(thread, /abandon\(\);\n\s+if \(state\.stubborn && !state\.stubbornTimer\) state\.stubbornTimer = SetTimer\(nullptr, 0, StubbornAfterMs, &AfterAbandon\);/);
  assert.match(thread, /if \(state\.stubbornTimer\) KillTimer\(nullptr, state\.stubbornTimer\);/);
  assert.match(dialogs, /~FileDialogWatch\(\) noexcept \{\n\s+ModalWatch::Disarm\(\);\n\s+if \(m_events\) m_dialog->Unadvise\(m_events\);/);
  assert.match(source("../../../../packages/expo-windows/src/selfCheck/heldDialogs.ts") , /await Promise\.race\(\[held, settled\(GIVE_UP_MS\)\]\);/);
  const held = source("../../../../packages/expo-windows/src/selfCheck/heldDialogs.ts");
  assert.match(held, /if \(when === "shown"\) expectTrue\(await dialogWindowShown\(SHOWN_MS\), /, "the shown case waits for the dialog's own window, not only for the dialog thread to start");
  assert.match(held, /run: \(\) => heldFileDialogCancels\(false, "atOnce"\),/);
  assert.doesNotMatch(held, /while it is still starting/, "no check claims a cancel during startup it can't force");
  assert.match(held, /\$\{shownAtCancel \? "its window shown" : "still starting"\} at its cancel/);
  assert.match(native("ModalThread.h"), /if \(dialog && IsWindowVisible\(dialog\)\) shown\+\+;/);
  assert.match(native("DialogsModule.h"), /int shownCount\(\) noexcept \{ return DialogParts::ShownDialogCount\(\); \}/);
  assert.match(thread, /if \(Stopping\(\)\) LaunchLog::Write\(L"dialog", L"a dialog's thread ended "/);
  assert.match(native("DialogsModule.h"), /REACT_METHOD\(devHoldFileDialog\)\n\s+void devHoldFileDialog\(std::string windowId, bool save, [^)]*\) noexcept \{\n\s+if \(!AppLaunch::Shared\(\)\.testInstance\) return promise\.Reject/);
});

test("every dialog's thread logs when it started, when its window showed, when a file dialog opened its first folder, and how late it took a cancel", () => {
  const native = (name) => readFileSync(new URL(`../../windows/Ardia/${name}`, import.meta.url), "utf8");
  const thread = native("ModalThread.h");
  assert.match(thread, /LaunchLog::Write\(L"dialog", state\.kind \+ L" thread started"\);/);
  assert.match(thread, /NoteModalDialog\(m_owner, dialog\);\n\s+ModalWatch::NoteShown\(\);/, "shown is noted where the shown count learns of the window");
  assert.match(thread, /state\.cancelTakenAt = GetTickCount64\(\);\n\s+state\.askedAt = released \|\| Stopping\(\) \? AskedToCloseAt\(\) : 0;\n\s+abandon\(\);/);
  assert.match(thread, /LaunchLog::Write\(L"dialog", DialogLifetime\(state\)\);/);
  assert.match(thread, /ModalRegistry::Shared\(\)\.releasedAt = GetTickCount64\(\);/);
  const dialogs = native("NativeDialogs.h");
  assert.match(dialogs, /HRESULT __stdcall OnFolderChange\(IFileDialog \*\) noexcept override \{\n\s+ModalWatch::NoteFirstFolder\(\);/);
  assert.match(dialogs, /dialog->Advise\(events\.get\(\), &m_events\)/);
  assert.ok(native("DialogsModule.h").includes("watch(owner, kind)"), "each dialog's watch knows its kind");
  const smoke = readFileSync(new URL("../../../../scripts/windows/launch-smoke.ps1", import.meta.url), "utf8");
  assert.ok(smoke.includes('-Pattern "self-check|webgl2 probe|^dialog |^(js-error|fatal|error) "'), "CI prints the dialog lines beside the self-check's");
});
