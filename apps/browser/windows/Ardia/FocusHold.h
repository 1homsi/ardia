#pragma once

#include <algorithm>
#include <cstdlib>
#include <map>
#include <mutex>
#include <optional>
#include <set>
#include <string>
#include <vector>

#include "LaunchConfig.h"
#include "LaunchLog.h"
#include "Paths.h"
#include "WindowManager.h"

namespace Ardia::Menus {

struct FocusHold {
  static constexpr size_t kCapacity = 64;
  static constexpr ULONGLONG kReadyMs = 3000;
  static constexpr UINT_PTR kTimer = 2099;
  static constexpr UINT kTickMs = 15;
  static constexpr UINT kSentinel = WM_APP + 0x99;

  enum class Taken { Pass, Held };

  struct Counts {
    unsigned holds = 0;
    unsigned replayed = 0;
    std::map<std::string, unsigned> drops;
  };

  bool active = false;
  int generation = 0;
  int lastGeneration = 0;
  HWND window = nullptr;
  std::string command;
  ULONGLONG startedAt = 0;
  int claimedTag = 0;
  int focusedTag = 0;
  bool ready = false;
  bool sentinelOut = false;
  std::vector<wchar_t> held;
  unsigned replayed = 0;
  std::set<UINT> heldKeys;
  HWND messages = nullptr;
  HHOOK mouseHook = nullptr;
  HWINEVENTHOOK foregroundHook = nullptr;
  std::mutex countsLock;
  Counts counts;

  static FocusHold &Shared() noexcept {
    static FocusHold *shared = new FocusHold();
    return *shared;
  }

  static HWND OwnerRoot(HWND hwnd) noexcept {
    return hwnd ? GetAncestor(hwnd, GA_ROOTOWNER) : nullptr;
  }

  static bool ClassIs(HWND hwnd, std::wstring_view name) noexcept {
    wchar_t buffer[64] = {};
    int length = hwnd ? GetClassNameW(hwnd, buffer, 64) : 0;
    return length > 0 && std::wstring_view(buffer, static_cast<size_t>(length)) == name;
  }

  static LRESULT CALLBACK MessageProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) noexcept {
    FocusHold &hold = Shared();
    if (message == WM_TIMER && wParam == kTimer) {
      hold.Tick();
      return 0;
    }
    if (message == kSentinel) {
      hold.Delivered(static_cast<int>(wParam));
      return 0;
    }
    return DefWindowProcW(hwnd, message, wParam, lParam);
  }

  static LRESULT CALLBACK MouseProc(int code, WPARAM wParam, LPARAM lParam) noexcept {
    FocusHold &hold = Shared();
    if (code == HC_ACTION && hold.active) {
      switch (wParam) {
        case WM_LBUTTONDOWN:
        case WM_RBUTTONDOWN:
        case WM_MBUTTONDOWN:
        case WM_XBUTTONDOWN:
        case WM_NCLBUTTONDOWN:
        case WM_NCRBUTTONDOWN:
        case WM_NCMBUTTONDOWN:
        case WM_NCXBUTTONDOWN:
          hold.Drop("mouse", L"a mouse button");
          break;
        default:
          break;
      }
    }
    return CallNextHookEx(hold.mouseHook, code, wParam, lParam);
  }

  static void CALLBACK ForegroundChanged(HWINEVENTHOOK, DWORD, HWND hwnd, LONG, LONG, DWORD, DWORD) noexcept {
    FocusHold &hold = Shared();
    if (hold.active && OwnerRoot(hwnd) != hold.window) hold.Drop("window", L"the window lost the keyboard");
  }

  HWND Messages() noexcept {
    if (messages) return messages;
    WNDCLASSW type{};
    type.lpfnWndProc = &FocusHold::MessageProc;
    type.hInstance = GetModuleHandleW(nullptr);
    type.lpszClassName = L"ArdiaFocusHold";
    RegisterClassW(&type);
    messages = CreateWindowExW(0, L"ArdiaFocusHold", L"", 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr, type.hInstance, nullptr);
    return messages;
  }

  static ULONGLONG ReadyFloorMs() noexcept {
    static const ULONGLONG floor = []() noexcept -> ULONGLONG {
      std::optional<std::string> asked = AppLaunch::TestValue("keyHoldReadyMs");
      if (!asked) return 0;
      char *end = nullptr;
      unsigned long long value = std::strtoull(asked->c_str(), &end, 10);
      return end && *end == '\0' ? (std::min)(static_cast<ULONGLONG>(value), kReadyMs / 2) : 0;
    }();
    return floor;
  }

  static bool Allowed() noexcept {
    return !WindowManager::Background() || AppLaunch::TestFlag("keyHold");
  }

  int Begin(HWND app, std::string const &name) noexcept {
    if (active) Drop("command", L"another command");
    HWND root = OwnerRoot(app);
    if (!root || !IsWindowVisible(root) || OwnerRoot(GetForegroundWindow()) != root || !Allowed() || !Messages()) return 0;
    active = true;
    generation = ++lastGeneration;
    window = root;
    command = name;
    startedAt = GetTickCount64();
    claimedTag = 0;
    ready = false;
    sentinelOut = false;
    held.clear();
    replayed = 0;
    {
      std::scoped_lock guard{countsLock};
      counts.holds++;
    }
    SetTimer(messages, kTimer, kTickMs, nullptr);
    if (!mouseHook) mouseHook = SetWindowsHookExW(WH_MOUSE, &FocusHold::MouseProc, nullptr, GetCurrentThreadId());
    if (!foregroundHook) {
      foregroundHook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, nullptr, &FocusHold::ForegroundChanged, GetCurrentProcessId(), 0, WINEVENT_OUTOFCONTEXT);
    }
    LaunchLog::Write(L"keys", L"hold " + std::to_wstring(generation) + L" begun for " + Paths::Wide(name));
    return generation;
  }

  void OtherCommand() noexcept {
    if (active) Drop("command", L"another command");
  }

  bool Repeating(UINT virtualKey, LPARAM flags) noexcept {
    if (!heldKeys.count(virtualKey)) return false;
    if (flags & (1u << 30)) return true;
    heldKeys.erase(virtualKey);
    return false;
  }

  void Released(UINT virtualKey) noexcept {
    heldKeys.erase(virtualKey);
  }

  Taken Key(UINT virtualKey, LPARAM flags) noexcept {
    if (!active) return Repeating(virtualKey, flags) ? Taken::Held : Taken::Pass;
    if (virtualKey == VK_PROCESSKEY || virtualKey == VK_PACKET) {
      Drop("ime", L"IME or packet input");
      return Taken::Pass;
    }
    switch (virtualKey) {
      case VK_SHIFT:
      case VK_LSHIFT:
      case VK_RSHIFT:
      case VK_CONTROL:
      case VK_LCONTROL:
      case VK_RCONTROL:
      case VK_MENU:
      case VK_LMENU:
      case VK_RMENU:
      case VK_LWIN:
      case VK_RWIN:
      case VK_CAPITAL:
      case VK_NUMLOCK:
      case VK_SCROLL:
        return Taken::Pass;
      default:
        break;
    }
    bool modified = (GetKeyState(VK_CONTROL) & 0x8000) || (GetKeyState(VK_MENU) & 0x8000) || (GetKeyState(VK_LWIN) & 0x8000) || (GetKeyState(VK_RWIN) & 0x8000);
    if (modified) {
      Drop("modified", L"a key with Ctrl, Alt or Win");
      return Taken::Pass;
    }
    if (virtualKey == VK_BACK || virtualKey == VK_RETURN) {
      Drop("edit", L"Backspace or Enter");
      return Taken::Pass;
    }
    BYTE state[256] = {};
    if (!GetKeyboardState(state)) {
      Drop("character", L"a key without a character");
      return Taken::Pass;
    }
    wchar_t units[8] = {};
    UINT scan = static_cast<UINT>((flags >> 16) & 0xFF);
    int typed = ToUnicodeEx(virtualKey, scan, state, units, 8, 0x4, GetKeyboardLayout(0));
    if (typed < 0) {
      Drop("dead", L"a dead key");
      return Taken::Pass;
    }
    bool printable = typed > 0;
    for (int i = 0; i < typed; i++) printable = printable && units[i] >= 0x20 && units[i] != 0x7F;
    if (!printable) {
      Drop("character", L"a key without a character");
      return Taken::Pass;
    }
    size_t repeat = (std::max)(static_cast<size_t>(flags & 0xFFFF), static_cast<size_t>(1));
    if (held.size() + repeat * static_cast<size_t>(typed) > kCapacity) {
      Drop("capacity", L"64 keys held");
      return Taken::Pass;
    }
    for (size_t r = 0; r < repeat; r++) held.insert(held.end(), units, units + typed);
    heldKeys.insert(virtualKey);
    Pump();
    return Taken::Held;
  }

  void Claim(int claimed, int tag) noexcept {
    if (!active || claimed != generation || tag <= 0) return;
    claimedTag = tag;
    Ready();
  }

  void Cancel(int cancelled) noexcept {
    if (active && cancelled == generation) Drop("cancelled", L"the focus move was cancelled");
  }

  void Focused(int tag) noexcept {
    focusedTag = tag;
    if (!active) return;
    if (claimedTag && tag != claimedTag) return Drop("focus", L"another field took focus");
    Ready();
  }

  void Blurred(int tag) noexcept {
    if (focusedTag == tag) focusedTag = 0;
    if (active && claimedTag && tag == claimedTag) Drop("focus", L"the field lost focus");
  }

  void Reloaded() noexcept {
    if (active) Drop("reload", L"the app reloaded");
  }

  void Ready() noexcept {
    if (!active || ready || !claimedTag || focusedTag != claimedTag || GetTickCount64() - startedAt < ReadyFloorMs()) return;
    ready = true;
    Pump();
  }

  bool Deliverable(HWND &site) noexcept {
    site = GetFocus();
    return IsWindow(window) && OwnerRoot(GetForegroundWindow()) == window && ClassIs(site, L"InputSiteWindowClass") && GetAncestor(site, GA_ROOT) == window;
  }

  void Pump() noexcept {
    if (!active || !ready || sentinelOut) return;
    if (held.empty()) return Finish();
    HWND site = nullptr;
    if (!Deliverable(site)) return Drop("site", L"the field's window doesn't have the keyboard");
    size_t units = held.size() > 1 && IS_HIGH_SURROGATE(held[0]) && IS_LOW_SURROGATE(held[1]) ? 2 : 1;
    for (size_t i = 0; i < units; i++) PostMessageW(site, WM_CHAR, held[i], 1);
    held.erase(held.begin(), held.begin() + static_cast<std::ptrdiff_t>(units));
    replayed++;
    sentinelOut = true;
    PostMessageW(messages, kSentinel, static_cast<WPARAM>(generation), 0);
  }

  void Delivered(int delivered) noexcept {
    if (!active || delivered != generation) return;
    sentinelOut = false;
    Pump();
  }

  void Tick() noexcept {
    if (!active) {
      if (messages) KillTimer(messages, kTimer);
      return;
    }
    if (!IsWindow(window)) return Drop("window", L"the window closed");
    if (OwnerRoot(GetForegroundWindow()) != window) return Drop("window", L"the window lost the keyboard");
    if (!ready && GetTickCount64() - startedAt > kReadyMs) return Drop("timeout", L"no field took the keyboard in 3 s");
    Ready();
  }

  void Stop() noexcept {
    active = false;
    held.clear();
    sentinelOut = false;
    if (messages) KillTimer(messages, kTimer);
    if (mouseHook) {
      UnhookWindowsHookEx(mouseHook);
      mouseHook = nullptr;
    }
    if (foregroundHook) {
      UnhookWinEvent(foregroundHook);
      foregroundHook = nullptr;
    }
  }

  void Finish() noexcept {
    {
      std::scoped_lock guard{countsLock};
      counts.replayed += replayed;
    }
    heldKeys.clear();
    LaunchLog::Write(L"keys", L"hold " + std::to_wstring(generation) + L" ready after " + std::to_wstring(GetTickCount64() - startedAt) + L" ms, replayed " + std::to_wstring(replayed));
    Stop();
  }

  void Drop(std::string const &reason, std::wstring const &why) noexcept {
    if (!active) return;
    {
      std::scoped_lock guard{countsLock};
      counts.replayed += replayed;
      counts.drops[reason]++;
    }
    LaunchLog::Write(L"keys", L"hold " + std::to_wstring(generation) + L" dropped: " + why + L" with " + std::to_wstring(held.size()) + L" held, " + std::to_wstring(replayed) + L" replayed");
    Stop();
  }

  Counts Take() noexcept {
    std::scoped_lock guard{countsLock};
    Counts taken = counts;
    counts = Counts{};
    return taken;
  }
};

}
