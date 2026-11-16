#pragma once

#include <atomic>
#include <chrono>
#include <optional>
#include <set>
#include <string>
#include <utility>

#include "Events.h"
#include "LaunchLog.h"
#include "MenuKeys.h"
#include "MenuPopup.h"
#include "MenuStore.h"
#include "NativeModules.h"
#include "Paths.h"
#include "WindowManager.h"

namespace Ardia::Menus {

struct ActiveWindow {
  HWND hwnd = nullptr;
  std::string id;
};

inline ActiveWindow ActiveArdiaWindow() noexcept {
  HWND active = GetActiveWindow();
  if (!active) return {};
  HWND root = GetAncestor(active, GA_ROOTOWNER);
  WindowManager &manager = WindowManager::Shared();
  for (std::string const &id : manager.Ids()) {
    HWND hwnd = manager.Hwnd(id);
    if (hwnd && GetAncestor(hwnd, GA_ROOT) == root) return {hwnd, id};
  }
  return {};
}

inline HWND MenuOwnerWindow() noexcept {
  if (HWND active = ActiveArdiaWindow().hwnd) return active;
  return WindowManager::Shared().ActiveHwnd();
}

struct SnapKeyMark {
  HWND app = nullptr;
  std::string windowId;
  UINT key = 0;
  ULONGLONG until = 0;
  bool shift = false;
};

struct EarlyKeyboard {
  HWND page = nullptr;
  HWND app = nullptr;
  std::string windowId;
  ULONGLONG until = 0;
  bool windowsUp = false;
};

struct MenuKeyboard {
  static constexpr ULONGLONG EarlyKeyboardMs = 5000;
  static constexpr int EarlyCheckDelayMs = 150;

  static constexpr ULONGLONG SnapKeyMarkMs = 500;
  static constexpr ULONGLONG SnapKeyAfterWindowsKeyMs = 1000;
  static constexpr int SnapKeyHandBackDelayMs = 500;
  static constexpr int SnapKeySendDelayMs = 100;
  static constexpr ULONGLONG SnapKeyWindowsReleaseMs = 2000;
  static constexpr ULONG_PTR SnapKeyTag = 0x41534B59;

  winrt::Microsoft::ReactNative::ReactContext context{nullptr};
  HHOOK keyboardHook = nullptr;
  HHOOK mouseHook = nullptr;
  bool trackingMenu = false;
  unsigned switcherHeld = 0;
  bool consumedWithAlt = false;
  bool escapeCaptured = false;
  bool switcherCaptured = false;
  bool capturedWHeld = false;
  std::atomic<bool> textInputFocused{false};
  std::set<UINT> swallowedKeyUps;
  std::set<UINT> snapKeysSeenDown;
  std::optional<SnapKeyMark> snapKeyMark;
  std::optional<SnapKeyMark> snapKeyHandBack;
  std::optional<SnapKeyMark> snapKeySend;
  winrt::Microsoft::UI::Dispatching::DispatcherQueueTimer snapKeyTimer{nullptr};
  winrt::Microsoft::UI::Dispatching::DispatcherQueueTimer snapKeySendTimer{nullptr};
  ULONGLONG windowsKeyReleasedAt = 0;
  bool windowsChordUsedControlOrAlt = false;
  std::optional<EarlyKeyboard> earlyKeyboard;
  HWINEVENTHOOK foregroundHook = nullptr;
  winrt::Microsoft::UI::Dispatching::DispatcherQueueTimer earlyCheckTimer{nullptr};
  winrt::Microsoft::UI::Dispatching::DispatcherQueueTimer earlyDeadlineTimer{nullptr};
  unsigned earlyHandedOver = 0;
  unsigned earlyHandedBack = 0;
  unsigned snapKeysHandedOver = 0;
  unsigned snapKeysHandedBack = 0;
  std::optional<winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue>> recording;

  static MenuKeyboard &Shared() noexcept {
    static MenuKeyboard *shared = new MenuKeyboard();
    return *shared;
  }

  void Install() noexcept {
    if (keyboardHook) return;
    keyboardHook = SetWindowsHookExW(WH_KEYBOARD, &MenuKeyboard::KeyboardProc, nullptr, GetCurrentThreadId());
    if (!keyboardHook) LaunchLog::Write(L"error", L"menus: the keyboard hook could not be installed");
  }

  static bool Background() noexcept {
    return WindowManager::Background();
  }

  void Emit(std::string const &command, std::optional<std::string> const &arg, std::string const &windowId) noexcept {
    using winrt::Microsoft::ReactNative::JSValue;
    using winrt::Microsoft::ReactNative::JSValueObject;
    JSValueObject payload;
    payload["command"] = JSValue{std::string{command}};
    payload["arg"] = arg ? JSValue{std::string{*arg}} : JSValue{nullptr};
    payload["windowId"] = windowId.empty() ? JSValue{nullptr} : JSValue{std::string{windowId}};
    payload["focusGeneration"] = JSValue{nullptr};
    EmitEvent(context, L"ArdiaMenus", L"onCommand", std::move(payload));
    LaunchLog::Write(L"command", Paths::Wide(command));
  }

  void EmitSwitcherReleased() noexcept {
    EmitEvent(context, L"ArdiaShell", L"onAppEvent", winrt::Microsoft::ReactNative::JSValueObject{{"type", "switcherReleased"}});
  }

  void SetEscapeCapture(bool active) noexcept {
    if (escapeCaptured == active) return;
    escapeCaptured = active;
    LaunchLog::Write(L"keys", active ? L"escape capture on" : L"escape capture off");
  }

  void SetSwitcherCapture(bool active) noexcept {
    if (switcherCaptured == active) return;
    switcherCaptured = active;
    LaunchLog::Write(L"keys", active ? L"switcher capture on" : L"switcher capture off");
  }

  static bool BareEscape(KeyPress const &press) noexcept {
    return press.virtualKey == VK_ESCAPE && (press.modifiers & (ModifierControl | ModifierOption | ModifierShift | ModifierCommand)) == 0;
  }

  bool CaptureEscape() noexcept {
    EmitEvent(context, L"ArdiaShell", L"onAppEvent", winrt::Microsoft::ReactNative::JSValueObject{{"type", "dragEscape"}});
    LaunchLog::Write(L"keys", L"escape sent to the open popover or drag");
    return true;
  }

  static bool ClosesSwitcherRow(KeyPress const &press, bool repeat) noexcept {
    return press.virtualKey == 'W' && !repeat && (press.modifiers & (ModifierControl | ModifierCommand)) != 0 && (press.modifiers & ModifierOption) == 0;
  }

  bool CaptureSwitcherKey(KeyPress const &press, bool repeat) noexcept {
    CommandEntry const *entry = MenuStore::Shared().Match(press);
    if (entry && entry->command == "tabSwitcher") return Dispatch(press);
    if (press.virtualKey == 'W') capturedWHeld = true;
    const char *key = nullptr;
    if (press.virtualKey == VK_ESCAPE) key = "escape";
    else if (press.virtualKey == VK_RIGHT) key = "next";
    else if (press.virtualKey == VK_LEFT) key = "previous";
    else if (ClosesSwitcherRow(press, repeat)) key = "close";
    if (key) EmitEvent(context, L"ArdiaShell", L"onAppEvent", winrt::Microsoft::ReactNative::JSValueObject{{"type", "switcherKey"}, {"key", key}});
    return true;
  }

  static bool PlainUndo(KeyPress const &press) noexcept {
    return press.virtualKey == 'Z' && press.modifiers == ModifierControl;
  }

  static bool PageHasFocus() noexcept {
    HWND focus = GetFocus();
    if (!focus) focus = GetActiveWindow();
    wchar_t name[16] = {};
    return focus && GetClassNameW(focus, name, 16) >= 7 && std::wstring_view(name, 7) == L"Chrome_";
  }

  bool UndoReopensClosedTab(KeyPress const &press, ActiveWindow const &window) noexcept {
    MenuStore const &store = MenuStore::Shared();
    if (!PlainUndo(press) || !store.undoReopensClosedTab || store.Disabled("reopenClosedTab") || window.id.empty()) return false;
    if (store.Match(press)) return false;
    if (!WindowManager::Shared().IsBrowserWindow(window.id)) return false;
    if (GetActiveWindow() != window.hwnd) {
      LaunchLog::Write(L"keys", L"ctrl+z left to the focused dialog or page");
      return false;
    }
    if (textInputFocused.load()) {
      LaunchLog::Write(L"keys", L"ctrl+z left to the focused text field");
      return false;
    }
    if (PageHasFocus()) {
      LaunchLog::Write(L"keys", L"ctrl+z left to the focused page");
      return false;
    }
    return true;
  }

  bool ReopenClosedTab(ActiveWindow const &window) noexcept {
    Emit("reopenClosedTab", std::nullopt, window.id);
    LaunchLog::Write(L"keys", L"ctrl+z reopens the last closed tab");
    return true;
  }

  static unsigned HeldModifiersOf(Combo const &combo) noexcept {
    unsigned held = combo.modifiers & (ModifierControl | ModifierOption | ModifierCommand);
    return held ? held : static_cast<unsigned>(combo.modifiers & ModifierShift);
  }

  void OpenedSwitcher(CommandEntry const &entry, KeyPress const &press) noexcept {
    unsigned held = 0;
    for (Combo const &combo : entry.active) {
      if (Matches(combo, press)) {
        held = HeldModifiersOf(combo);
        break;
      }
    }
    switcherHeld = held && (press.modifiers & held) == held ? held : 0;
    if (!switcherHeld && context) RunOnUI(context, []() noexcept { Shared().EmitSwitcherReleased(); });
  }

  void ModifiersChanged(unsigned modifiers) noexcept {
    if (!switcherHeld || (modifiers & switcherHeld) == switcherHeld) return;
    switcherHeld = 0;
    EmitSwitcherReleased();
  }

  static bool NativeActionAvailable(std::string_view id, ActiveWindow const &window) noexcept {
    if (id == "std:miniaturizeAll:") return !WindowManager::Shared().Ids().empty();
    return window.hwnd != nullptr;
  }

  static void Minimize(HWND hwnd) noexcept {
    if (hwnd && IsWindowVisible(hwnd)) ShowWindow(hwnd, SW_MINIMIZE);
  }

  void PerformNative(std::string_view id, ActiveWindow const &window) noexcept {
    if (Background() && id != "std:closeWindow:" && id != "std:toggleKeepOnTop:") {
      LogActivation(std::string{id.substr(4)} + " (acted out)");
      return;
    }
    HWND hwnd = window.hwnd;
    if (id == "std:closeWindow:") {
      if (hwnd) PostMessageW(hwnd, WM_CLOSE, 0, 0);
    } else if (id == "std:toggleFullScreen:") {
      if (!hwnd) return;
      try {
        using winrt::Microsoft::UI::Windowing::AppWindow;
        using winrt::Microsoft::UI::Windowing::AppWindowPresenterKind;
        AppWindow appWindow = AppWindow::GetFromWindowId(winrt::Microsoft::UI::GetWindowIdFromWindow(hwnd));
        if (!appWindow) return;
        bool fullScreen = appWindow.Presenter().Kind() == AppWindowPresenterKind::FullScreen;
        appWindow.SetPresenter(fullScreen ? AppWindowPresenterKind::Overlapped : AppWindowPresenterKind::FullScreen);
      } catch (...) {
        LaunchLog::Write(L"error", L"menus: full screen could not be toggled");
      }
    } else if (id == "std:performMiniaturize:") {
      Minimize(hwnd);
    } else if (id == "std:miniaturizeAll:") {
      WindowManager &manager = WindowManager::Shared();
      for (std::string const &windowId : manager.Ids()) Minimize(manager.Hwnd(windowId));
    } else if (id == "std:performZoom:") {
      if (hwnd && IsWindowVisible(hwnd)) ShowWindow(hwnd, IsZoomed(hwnd) ? SW_RESTORE : SW_MAXIMIZE);
    } else if (id == "std:toggleKeepOnTop:") {
      if (!hwnd) return;
      bool topmost = (GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & WS_EX_TOPMOST) != 0;
      SetWindowPos(hwnd, topmost ? HWND_NOTOPMOST : HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
    }
  }

  bool Dispatch(KeyPress const &press) noexcept {
    MenuStore &store = MenuStore::Shared();
    CommandEntry const *entry = store.Match(press);
    if (!entry) return false;
    ActiveWindow window = ActiveArdiaWindow();
    if (entry->Native()) {
      if (!NativeActionAvailable(entry->id, window)) return false;
      PerformNative(entry->id, window);
      return true;
    }
    if (entry->command == "closeTab" && WindowManager::Shared().IsPopupWindow(window.id)) {
      PostMessageW(window.hwnd, WM_CLOSE, 0, 0);
      LaunchLog::Write(L"keys", L"close tab closes the pop-up window");
      return true;
    }
    if (!WindowManager::Shared().IsPopupWindow(window.id) && !store.EntryEnabled(*entry)) return false;
    Emit(entry->command, entry->arg, window.id);
    if (entry->command == "tabSwitcher") OpenedSwitcher(*entry, press);
    return true;
  }

  void StartRecording(winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> const &promise) noexcept {
    FinishRecording(winrt::Microsoft::ReactNative::JSValue{nullptr});
    recording.emplace(promise);
    if (!mouseHook) mouseHook = SetWindowsHookExW(WH_MOUSE, &MenuKeyboard::MouseProc, nullptr, GetCurrentThreadId());
  }

  void FinishRecording(winrt::Microsoft::ReactNative::JSValue &&result) noexcept {
    if (mouseHook) {
      UnhookWindowsHookEx(mouseHook);
      mouseHook = nullptr;
    }
    if (!recording) return;
    auto pending = *recording;
    recording.reset();
    pending.Resolve(result);
  }

  bool Record(KeyPress const &press) noexcept {
    using winrt::Microsoft::ReactNative::JSValue;
    using winrt::Microsoft::ReactNative::JSValueArray;
    using winrt::Microsoft::ReactNative::JSValueObject;
    if (press.virtualKey == VK_ESCAPE && press.modifiers == 0) {
      FinishRecording(JSValue{nullptr});
      return true;
    }
    wchar_t key = RecordedKey(press);
    if (!key) return true;
    bool held = (press.modifiers & (ModifierControl | ModifierOption)) != 0;
    if (!held && !IsFunctionKey(key)) {
      MessageBeep(MB_OK);
      return true;
    }
    JSValueArray modifiers;
    for (unsigned modifier : kModifierOrder) {
      if (press.modifiers & modifier) modifiers.push_back(JSValue{std::string{ModifierNameOf(modifier)}});
    }
    FinishRecording(JSValue{JSValueObject{{"key", Paths::Utf8(std::wstring(1, key))}, {"modifiers", std::move(modifiers)}}});
    return true;
  }

  static bool IsSnapKey(UINT key) noexcept {
    return key == VK_UP || key == VK_DOWN || key == VK_LEFT || key == VK_RIGHT || key == 'Z';
  }

  static bool IsWindowsKey(UINT key) noexcept {
    return key == VK_LWIN || key == VK_RWIN;
  }

  static bool IsShiftKey(UINT key) noexcept {
    return key == VK_SHIFT || key == VK_LSHIFT || key == VK_RSHIFT;
  }

  static bool WindowsKeyHeldNow() noexcept {
    return (GetKeyState(VK_LWIN) & 0x8000) != 0 || (GetKeyState(VK_RWIN) & 0x8000) != 0;
  }

  static bool WindowsKeyPhysicallyHeld() noexcept {
    return (GetAsyncKeyState(VK_LWIN) & 0x8000) != 0 || (GetAsyncKeyState(VK_RWIN) & 0x8000) != 0;
  }

  static bool ControlOrAltHeldNow() noexcept {
    return (GetKeyState(VK_CONTROL) & 0x8000) != 0 || (GetKeyState(VK_MENU) & 0x8000) != 0;
  }

  static bool IsControlOrAltKey(UINT key) noexcept {
    return key == VK_CONTROL || key == VK_LCONTROL || key == VK_RCONTROL || key == VK_MENU || key == VK_LMENU || key == VK_RMENU;
  }

  static bool ShiftHeldNow() noexcept {
    return (GetKeyState(VK_SHIFT) & 0x8000) != 0;
  }

  static bool ShiftPhysicallyHeld() noexcept {
    return (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0;
  }

  static bool ControlOrAltPhysicallyHeld() noexcept {
    return (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0 || (GetAsyncKeyState(VK_MENU) & 0x8000) != 0;
  }

  void ForgetReleasedSnapKeys() noexcept {
    for (auto it = snapKeysSeenDown.begin(); it != snapKeysSeenDown.end();) {
      if (GetAsyncKeyState(static_cast<int>(*it)) & 0x8000) ++it;
      else it = snapKeysSeenDown.erase(it);
    }
  }

  static std::wstring SnapKeyName(UINT key) {
    switch (key) {
      case VK_UP: return L"Win+Up";
      case VK_DOWN: return L"Win+Down";
      case VK_LEFT: return L"Win+Left";
      case VK_RIGHT: return L"Win+Right";
      default: return L"Win+Z";
    }
  }

  static ActiveWindow HostOfPage(HWND page) noexcept {
    wchar_t name[16] = {};
    if (!page || GetClassNameW(page, name, 16) < 7 || std::wstring_view(name, 7) != L"Chrome_") return {};
    HWND owner = GetWindow(page, GW_OWNER);
    if (!owner) return {};
    WindowManager &manager = WindowManager::Shared();
    for (std::string const &id : manager.Ids()) {
      if (manager.Hwnd(id) == owner) return {owner, id};
    }
    return {};
  }

  void WatchSnapKey(UINT key, bool keyUp, bool repeat) noexcept {
    ULONGLONG now = GetTickCount64();
    bool sentHere = static_cast<ULONG_PTR>(GetMessageExtraInfo()) == SnapKeyTag;
    if (IsWindowsKey(key)) {
      if (sentHere) return;
      if (keyUp) {
        windowsKeyReleasedAt = now;
        if (snapKeySend && snapKeySend->until) RestartSnapKeySend();
      } else if (!repeat) {
        windowsChordUsedControlOrAlt = false;
        ForgetReleasedSnapKeys();
      }
      return;
    }
    if (IsShiftKey(key)) return;
    if (!keyUp && !sentHere && IsControlOrAltKey(key) && WindowsKeyHeldNow()) windowsChordUsedControlOrAlt = true;
    if (snapKeyHandBack) {
      snapKeyHandBack.reset();
      LaunchLog::Write(L"keys", L"snap keys: another key came before the hand-back, so the keyboard stays in the app window");
    }
    if (snapKeySend && !sentHere) {
      snapKeySend.reset();
      LaunchLog::Write(L"keys", L"snap keys: another key came before the send, so nothing was sent");
    }
    if (snapKeyMark && SettleSnapKeyMark(key, keyUp, now, sentHere)) return;
    if (sentHere || !IsSnapKey(key)) return;
    if (!keyUp) {
      snapKeysSeenDown.insert(key);
      return;
    }
    if (snapKeysSeenDown.erase(key)) return;
    if (ControlOrAltHeldNow() || windowsChordUsedControlOrAlt) return;
    if (!WindowsKeyHeldNow() && now - windowsKeyReleasedAt > SnapKeyAfterWindowsKeyMs) return;
    HandOverSnapKey(key);
  }

  void HandOverSnapKey(UINT key) noexcept {
    HWND page = GetForegroundWindow();
    ActiveWindow host = HostOfPage(page);
    if (!host.hwnd || !context) return;
    if (Background()) {
      LaunchLog::Write(L"keys", L"snap keys: " + SnapKeyName(key) + L" with a page focused (acted out)");
      return;
    }
    bool shift = ShiftHeldNow();
    RunOnUI(context, [page, host, key, shift]() noexcept { Shared().SendSnapKey(page, host, key, shift); });
  }

  static std::string const &SnapStrategy() noexcept {
    static const std::string strategy = AppLaunch::TestValue("snapKeys").value_or(std::string{});
    return strategy;
  }

  void WatchWindowsChord(UINT key, bool keyUp, bool repeat) noexcept {
    std::string const &strategy = SnapStrategy();
    if (strategy == "early") WatchEarlyKey(key, keyUp, repeat);
    else if (strategy == "late") WatchSnapKey(key, keyUp, repeat);
  }

  static bool OurWindow(HWND hwnd) noexcept {
    DWORD process = 0;
    GetWindowThreadProcessId(hwnd, &process);
    return hwnd && process == GetCurrentProcessId();
  }

  void RestartTimer(winrt::Microsoft::UI::Dispatching::DispatcherQueueTimer &timer, int delayMs, void (MenuKeyboard::*fire)() noexcept) noexcept {
    try {
      if (!timer) timer = OneShotTimer(delayMs, fire);
      if (!timer) return;
      timer.Stop();
      timer.Start();
    } catch (...) {
      LaunchLog::Write(L"error", L"snap keys: a timer could not start");
    }
  }

  void WatchEarlyKey(UINT key, bool keyUp, bool repeat) noexcept {
    if (IsWindowsKey(key)) {
      if (!keyUp) {
        if (!repeat) HoldKeyboardForWindowsKey();
      } else if (earlyKeyboard) {
        earlyKeyboard->windowsUp = true;
        RestartTimer(earlyCheckTimer, EarlyCheckDelayMs, &MenuKeyboard::CheckEarlyKeyboard);
      }
      return;
    }
    if (!earlyKeyboard || !keyUp || earlyKeyboard->windowsUp) return;
    if (IsSnapKey(key) || IsShiftKey(key) || IsControlOrAltKey(key)) return;
    HandEarlyKeyboardBack(L"at the key-up of another key pressed with the Windows key");
  }

  void HoldKeyboardForWindowsKey() noexcept {
    HWND foreground = GetForegroundWindow();
    ActiveWindow host = HostOfPage(foreground);
    if (!host.hwnd) {
      if (earlyKeyboard) {
        earlyKeyboard->windowsUp = false;
        earlyKeyboard->until = GetTickCount64() + EarlyKeyboardMs;
        RestartTimer(earlyDeadlineTimer, static_cast<int>(EarlyKeyboardMs), &MenuKeyboard::EarlyKeyboardLapsed);
      }
      return;
    }
    if (!context) return;
    if (Background()) {
      LaunchLog::Write(L"keys", L"snap keys: the Windows key went down over a page (acted out)");
      return;
    }
    if (earlyKeyboard) DropEarlyKeyboard(L"a new Windows key press over a page replaced it");
    earlyKeyboard = EarlyKeyboard{foreground, host.hwnd, host.id, GetTickCount64() + EarlyKeyboardMs, false};
    RunOnUI(context, []() noexcept { Shared().TakeKeyboardForWindowsKey(); });
  }

  void TakeKeyboardForWindowsKey() noexcept {
    if (!earlyKeyboard) return;
    EarlyKeyboard hold = *earlyKeyboard;
    if (GetForegroundWindow() != hold.page || !IsWindow(hold.app)) {
      DropEarlyKeyboard(L"the page lost the foreground before the app window could take it");
      return;
    }
    SetForegroundWindow(hold.app);
    if (GetForegroundWindow() != hold.app) {
      DropEarlyKeyboard(L"the app window did not take the foreground");
      return;
    }
    ++earlyHandedOver;
    LaunchLog::Write(L"keys", L"snap keys: the Windows key went down over a page, so its app window took the keyboard (" + std::to_wstring(earlyHandedOver) + L" so far)");
    if (!foregroundHook) foregroundHook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, nullptr, &MenuKeyboard::ForegroundChanged, 0, 0, WINEVENT_OUTOFCONTEXT);
    RestartTimer(earlyDeadlineTimer, static_cast<int>(EarlyKeyboardMs), &MenuKeyboard::EarlyKeyboardLapsed);
    if (earlyKeyboard->windowsUp) RestartTimer(earlyCheckTimer, EarlyCheckDelayMs, &MenuKeyboard::CheckEarlyKeyboard);
  }

  static void CALLBACK ForegroundChanged(HWINEVENTHOOK, DWORD, HWND, LONG, LONG, DWORD, DWORD) noexcept {
    MenuKeyboard &keyboard = Shared();
    if (keyboard.earlyKeyboard && keyboard.earlyKeyboard->windowsUp) keyboard.RestartTimer(keyboard.earlyCheckTimer, EarlyCheckDelayMs, &MenuKeyboard::CheckEarlyKeyboard);
  }

  void CheckEarlyKeyboard() noexcept {
    if (!earlyKeyboard || !earlyKeyboard->windowsUp) return;
    EarlyKeyboard hold = *earlyKeyboard;
    if (!IsWindow(hold.page) || !IsWindow(hold.app)) {
      DropEarlyKeyboard(L"the page or its window went away");
      return;
    }
    if (GetTickCount64() > hold.until) {
      DropEarlyKeyboard(L"its deadline passed");
      return;
    }
    HWND foreground = GetForegroundWindow();
    if (foreground == hold.app) {
      if (IsIconic(hold.app)) DropEarlyKeyboard(L"the window is minimized");
      else HandEarlyKeyboardBack(L"after the Windows key");
      return;
    }
    if (foreground == hold.page) {
      DropEarlyKeyboard(L"the page has the keyboard already");
      return;
    }
    if (OurWindow(foreground)) {
      DropEarlyKeyboard(L"another window of the app is in front");
      return;
    }
    LaunchLog::Write(L"keys", L"snap keys: another program is in front, so the page waits for its window to come back");
  }

  void EarlyKeyboardLapsed() noexcept {
    if (earlyKeyboard) DropEarlyKeyboard(L"its deadline passed");
  }

  void HandEarlyKeyboardBack(std::wstring_view reason) noexcept {
    if (!earlyKeyboard) return;
    std::string windowId = earlyKeyboard->windowId;
    DropEarlyKeyboard({});
    ++earlyHandedBack;
    EmitEvent(context, L"ArdiaShell", L"onAppEvent", winrt::Microsoft::ReactNative::JSValueObject{{"type", "snapKeyHandedBack"}, {"windowId", windowId}});
    LaunchLog::Write(L"keys", L"snap keys: the keyboard went back to the page " + std::wstring{reason} + L" (" + std::to_wstring(earlyHandedBack) + L" so far)");
  }

  void DropEarlyKeyboard(std::wstring_view reason) noexcept {
    earlyKeyboard.reset();
    try {
      if (earlyCheckTimer) earlyCheckTimer.Stop();
      if (earlyDeadlineTimer) earlyDeadlineTimer.Stop();
    } catch (...) {
      LaunchLog::Write(L"error", L"snap keys: a timer could not stop");
    }
    if (foregroundHook) {
      UnhookWinEvent(foregroundHook);
      foregroundHook = nullptr;
    }
    if (!reason.empty()) LaunchLog::Write(L"keys", L"snap keys: the page's keyboard is let go: " + std::wstring{reason});
  }

  static winrt::Microsoft::UI::Dispatching::DispatcherQueueTimer OneShotTimer(int delayMs, void (MenuKeyboard::*fire)() noexcept) {
    auto queue = winrt::Microsoft::UI::Dispatching::DispatcherQueue::GetForCurrentThread();
    if (!queue) return nullptr;
    auto timer = queue.CreateTimer();
    timer.Interval(std::chrono::milliseconds(delayMs));
    timer.IsRepeating(false);
    timer.Tick([fire](auto const &, auto const &) noexcept { (Shared().*fire)(); });
    return timer;
  }

  void SendSnapKey(HWND page, ActiveWindow const &host, UINT key, bool shift) noexcept {
    std::wstring name = SnapKeyName(key);
    if (GetForegroundWindow() != page || !IsWindow(host.hwnd)) {
      LaunchLog::Write(L"keys", L"snap keys: " + name + L": the page lost the foreground first, so nothing was sent");
      return;
    }
    if (ControlOrAltPhysicallyHeld()) {
      LaunchLog::Write(L"keys", L"snap keys: " + name + L": Ctrl or Alt is held, so nothing was sent");
      return;
    }
    SetForegroundWindow(host.hwnd);
    snapKeySend = SnapKeyMark{host.hwnd, host.id, key, 0, shift};
    RestartSnapKeySend();
  }

  void RestartSnapKeySend() noexcept {
    try {
      if (!snapKeySendTimer) snapKeySendTimer = OneShotTimer(SnapKeySendDelayMs, &MenuKeyboard::SendPendingSnapKey);
      if (!snapKeySendTimer) {
        snapKeySend.reset();
        return;
      }
      snapKeySendTimer.Stop();
      snapKeySendTimer.Start();
    } catch (...) {
      snapKeySend.reset();
      LaunchLog::Write(L"error", L"snap keys: the send could not be timed");
    }
  }

  void SendPendingSnapKey() noexcept {
    if (!snapKeySend) return;
    SnapKeyMark pending = *snapKeySend;
    UINT key = pending.key;
    std::wstring name = SnapKeyName(key);
    if (WindowsKeyPhysicallyHeld()) {
      ULONGLONG now = GetTickCount64();
      if (!pending.until) {
        snapKeySend->until = now + SnapKeyWindowsReleaseMs;
        LaunchLog::Write(L"keys", L"snap keys: " + name + L" waits for the Windows key to be let go");
        return;
      }
      snapKeySend.reset();
      LaunchLog::Write(L"keys", L"snap keys: " + name + L": a Windows key is still held, so nothing was sent");
      return;
    }
    snapKeySend.reset();
    if (pending.until && GetTickCount64() > pending.until) {
      LaunchLog::Write(L"keys", L"snap keys: " + name + L": the Windows key was held too long, so nothing was sent");
      return;
    }
    if (ControlOrAltPhysicallyHeld()) {
      LaunchLog::Write(L"keys", L"snap keys: " + name + L": Ctrl or Alt is held, so nothing was sent");
      return;
    }
    bool shiftHeld = ShiftPhysicallyHeld();
    if (shiftHeld && !pending.shift) {
      LaunchLog::Write(L"keys", L"snap keys: " + name + L": Shift went down after the key, so nothing was sent");
      return;
    }
    bool addShift = pending.shift && !shiftHeld;
    INPUT inputs[6] = {};
    UINT count = 0;
    auto add = [&inputs, &count](WORD virtualKey, bool up) noexcept {
      INPUT &input = inputs[count++];
      input.type = INPUT_KEYBOARD;
      input.ki.wVk = virtualKey;
      input.ki.wScan = static_cast<WORD>(MapVirtualKeyW(virtualKey, MAPVK_VK_TO_VSC));
      input.ki.dwFlags = (up ? KEYEVENTF_KEYUP : 0) | (virtualKey == 'Z' || virtualKey == VK_LSHIFT ? 0 : KEYEVENTF_EXTENDEDKEY);
      input.ki.dwExtraInfo = SnapKeyTag;
    };
    add(VK_LWIN, false);
    if (addShift) add(VK_LSHIFT, false);
    add(static_cast<WORD>(key), false);
    add(static_cast<WORD>(key), true);
    if (addShift) add(VK_LSHIFT, true);
    add(VK_LWIN, true);
    if (!IsWindow(pending.app) || GetForegroundWindow() != pending.app) {
      snapKeyMark.reset();
      LaunchLog::Write(L"keys", L"snap keys: " + name + L": the app window did not hold the foreground, so nothing was sent");
      return;
    }
    snapKeyMark = SnapKeyMark{pending.app, pending.windowId, key, GetTickCount64() + SnapKeyMarkMs};
    UINT sent = SendInput(count, inputs, sizeof(INPUT));
    if (sent != count) {
      snapKeyMark.reset();
      ReleaseUnmatchedDowns(inputs, sent);
      LaunchLog::Write(L"error", L"snap keys: " + name + L" could not be sent to the app window");
      return;
    }
    ++snapKeysHandedOver;
    LaunchLog::Write(L"keys", L"snap keys: " + name + L" with a page focused went to the app window inside a Windows key press (" + std::to_wstring(snapKeysHandedOver) + L" so far)");
  }

  static void ReleaseUnmatchedDowns(INPUT const *inputs, UINT sent) noexcept {
    INPUT releases[3] = {};
    UINT count = 0;
    for (UINT i = sent; i-- > 0;) {
      if (inputs[i].ki.dwFlags & KEYEVENTF_KEYUP) continue;
      bool released = false;
      for (UINT j = i + 1; j < sent; ++j) released = released || (inputs[j].ki.wVk == inputs[i].ki.wVk && (inputs[j].ki.dwFlags & KEYEVENTF_KEYUP));
      if (released || count == 3) continue;
      releases[count] = inputs[i];
      releases[count].ki.dwFlags |= KEYEVENTF_KEYUP;
      ++count;
    }
    if (count) SendInput(count, releases, sizeof(INPUT));
  }

  bool SettleSnapKeyMark(UINT key, bool keyUp, ULONGLONG now, bool sentHere) noexcept {
    SnapKeyMark mark = *snapKeyMark;
    bool inTime = now <= mark.until;
    bool ours = key == mark.key && (sentHere || inTime);
    if (!ours) {
      snapKeyMark.reset();
      LaunchLog::Write(L"keys", inTime ? L"snap keys: another key came first, so the keyboard stays in the app window" : L"snap keys: the hand-back mark lapsed, so the keyboard stays where it is");
      return false;
    }
    if (!inTime || !IsWindow(mark.app) || GetForegroundWindow() != mark.app) {
      if (keyUp) snapKeyMark.reset();
      LaunchLog::Write(L"keys", L"snap keys: the app window lost the foreground before the sent key came back, so the keyboard stays where it is");
      return true;
    }
    if (!keyUp) {
      LaunchLog::Write(L"keys", L"snap keys: the shell let the sent key through to the app window");
      return true;
    }
    snapKeyMark.reset();
    snapKeysSeenDown.erase(key);
    if (key == 'Z') {
      LaunchLog::Write(L"keys", L"snap keys: Win+Z keeps the keyboard in the app window for the snap layouts");
      return true;
    }
    ScheduleSnapKeyHandBack(mark);
    return true;
  }

  void ScheduleSnapKeyHandBack(SnapKeyMark const &mark) noexcept {
    snapKeyHandBack = mark;
    try {
      if (!snapKeyTimer) snapKeyTimer = OneShotTimer(SnapKeyHandBackDelayMs, &MenuKeyboard::HandSnapKeyBack);
      if (!snapKeyTimer) {
        snapKeyHandBack.reset();
        return;
      }
      snapKeyTimer.Stop();
      snapKeyTimer.Start();
    } catch (...) {
      snapKeyHandBack.reset();
      LaunchLog::Write(L"error", L"snap keys: the hand-back could not be timed");
    }
  }

  void HandSnapKeyBack() noexcept {
    if (!snapKeyHandBack) return;
    SnapKeyMark mark = *snapKeyHandBack;
    snapKeyHandBack.reset();
    RECT rect{};
    GetWindowRect(mark.app, &rect);
    LaunchLog::Write(L"keys", L"snap keys: at the hand-back the window is at " + std::to_wstring(rect.left) + L"," + std::to_wstring(rect.top) + L"," + std::to_wstring(rect.right) + L"," + std::to_wstring(rect.bottom) + L" (maximized " + (IsZoomed(mark.app) ? L"yes" : L"no") + L", minimized " + (IsIconic(mark.app) ? L"yes" : L"no") + L", in front " + (GetForegroundWindow() == mark.app ? L"yes" : L"no") + L")");
    if (!IsWindow(mark.app) || GetForegroundWindow() != mark.app) {
      LaunchLog::Write(L"keys", L"snap keys: the app window lost the foreground, so the keyboard is not handed back");
      return;
    }
    if (IsIconic(mark.app)) {
      LaunchLog::Write(L"keys", L"snap keys: the window is minimized, so the keyboard is not handed back");
      return;
    }
    ++snapKeysHandedBack;
    EmitEvent(context, L"ArdiaShell", L"onAppEvent", winrt::Microsoft::ReactNative::JSValueObject{{"type", "snapKeyHandedBack"}, {"windowId", mark.windowId}});
    LaunchLog::Write(L"keys", L"snap keys: " + SnapKeyName(mark.key) + L" handed the keyboard back to the page (" + std::to_wstring(snapKeysHandedBack) + L" so far)");
  }

  bool HandleKey(UINT virtualKey, LPARAM flags) noexcept {
    bool keyUp = (flags & (1u << 31)) != 0;
    WatchWindowsChord(virtualKey, keyUp, (flags & (1u << 30)) != 0);
    if (keyUp) {
      if (virtualKey == 'W') capturedWHeld = false;
      if (unsigned released = ModifierOfKey(virtualKey)) ModifiersChanged(static_cast<unsigned>(HeldModifiers() & ~released));
      if (swallowedKeyUps.erase(virtualKey)) return true;
      if ((virtualKey == VK_MENU || virtualKey == VK_LMENU || virtualKey == VK_RMENU) && consumedWithAlt) {
        consumedWithAlt = false;
        return true;
      }
      return false;
    }
    if (IsModifierKey(virtualKey)) return false;
    if (capturedWHeld && virtualKey == 'W') {
      if (flags & (1u << 30)) return true;
      capturedWHeld = false;
    }
    if (trackingMenu) return false;
    KeyPress press = ReadKeyPress(virtualKey, flags);
    if (press.windowsKey || press.altGraph) return false;
    bool handled = false;
    if (recording) {
      handled = Record(press);
    } else {
      ActiveWindow window = ActiveArdiaWindow();
      if (!window.hwnd) return false;
      if (switcherCaptured) handled = CaptureSwitcherKey(press, (flags & (1u << 30)) != 0);
      else if (escapeCaptured && BareEscape(press)) handled = CaptureEscape();
      else if (UndoReopensClosedTab(press, window)) handled = ReopenClosedTab(window);
      else handled = Dispatch(press);
    }
    if (handled) {
      swallowedKeyUps.insert(virtualKey);
      if (press.modifiers & ModifierOption) consumedWithAlt = true;
    }
    return handled;
  }

  static LRESULT CALLBACK KeyboardProc(int code, WPARAM wParam, LPARAM lParam) noexcept {
    MenuKeyboard &keyboard = Shared();
    if (code == HC_ACTION) {
      bool handled = false;
      try {
        handled = keyboard.HandleKey(static_cast<UINT>(wParam), lParam);
      } catch (...) {
        handled = false;
      }
      if (handled) return 1;
    }
    return CallNextHookEx(keyboard.keyboardHook, code, wParam, lParam);
  }

  static LRESULT CALLBACK MouseProc(int code, WPARAM wParam, LPARAM lParam) noexcept {
    MenuKeyboard &keyboard = Shared();
    if (code == HC_ACTION && keyboard.recording) {
      switch (wParam) {
        case WM_LBUTTONDOWN:
        case WM_RBUTTONDOWN:
        case WM_MBUTTONDOWN:
        case WM_NCLBUTTONDOWN:
        case WM_NCRBUTTONDOWN:
          keyboard.FinishRecording(winrt::Microsoft::ReactNative::JSValue{nullptr});
          break;
        default:
          break;
      }
    }
    return CallNextHookEx(keyboard.mouseHook, code, wParam, lParam);
  }
};

}
