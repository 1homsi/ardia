#pragma once

#include <string>

#include "LaunchConfig.h"
#include "LaunchLog.h"

namespace Ardia::Menus {

struct KeyProbe {
  ULONGLONG watchUntil = 0;
  int seen = 0;

  static KeyProbe &Shared() noexcept {
    static KeyProbe *shared = new KeyProbe();
    return *shared;
  }

  static bool Enabled() noexcept {
    static const bool enabled = AppLaunch::TestFlag("keyProbe");
    return enabled;
  }

  static std::wstring ClassOf(HWND window) noexcept {
    wchar_t name[128] = {};
    if (window) GetClassNameW(window, name, 128);
    return name;
  }

  static std::wstring Describe(HWND window) noexcept {
    if (!window) return L"none";
    HWND root = GetAncestor(window, GA_ROOT);
    HWND foreground = GetForegroundWindow();
    return ClassOf(window) + L" " + std::to_wstring(reinterpret_cast<uintptr_t>(window)) + L", root " + ClassOf(root) + L" " +
           std::to_wstring(reinterpret_cast<uintptr_t>(root)) + L", foreground " + ClassOf(foreground) + L" " +
           std::to_wstring(reinterpret_cast<uintptr_t>(foreground)) + (root == GetAncestor(foreground, GA_ROOT) ? L" (same root)" : L" (another root)");
  }

  static std::wstring NameOf(UINT virtualKey) noexcept {
    if (virtualKey >= 'A' && virtualKey <= 'Z') return std::wstring(1, static_cast<wchar_t>(virtualKey));
    if (virtualKey == VK_SHIFT) return L"Shift";
    if (virtualKey == VK_CAPITAL) return L"CapsLock";
    return L"vk" + std::to_wstring(virtualKey);
  }

  static void PostKey(HWND to, UINT virtualKey, bool up) noexcept {
    LPARAM scan = static_cast<LPARAM>(MapVirtualKeyW(virtualKey, MAPVK_VK_TO_VSC));
    LPARAM flags = 1 | (scan << 16) | (up ? (static_cast<LPARAM>(3) << 30) : 0);
    PostMessageW(to, up ? WM_KEYUP : WM_KEYDOWN, virtualKey, flags);
  }

  bool Handle(UINT virtualKey, bool keyUp) noexcept {
    if (!Enabled()) return false;
    bool trigger = virtualKey == VK_F22 || virtualKey == VK_F23 || virtualKey == VK_F24;
    if (!trigger && watchUntil && GetTickCount64() < watchUntil) {
      LaunchLog::Write(L"keys", L"key probe saw " + NameOf(virtualKey) + (keyUp ? L" up #" : L" down #") + std::to_wstring(++seen));
    }
    if (!trigger) return false;
    if (keyUp) return true;
    HWND focus = GetFocus();
    LaunchLog::Write(L"keys", L"key probe focus: " + Describe(focus));
    if (!focus || virtualKey == VK_F22) return true;
    if (virtualKey == VK_F24) {
      PostKey(focus, VK_SHIFT, false);
      PostKey(focus, 'R', false);
      PostKey(focus, 'R', true);
      PostKey(focus, VK_SHIFT, true);
      PostKey(focus, 'P', false);
      PostKey(focus, 'P', true);
      seen = 0;
      watchUntil = GetTickCount64() + 2000;
      LaunchLog::Write(L"keys", L"key probe posted 6 key messages: Shift down, R down, R up, Shift up, P down, P up");
      return true;
    }
    PostMessageW(focus, WM_CHAR, L'S', 1);
    PostMessageW(focus, WM_CHAR, L't', 1);
    LaunchLog::Write(L"keys", L"key probe posted WM_CHAR S and t");
    return true;
  }
};

}
