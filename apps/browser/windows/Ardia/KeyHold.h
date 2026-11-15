#pragma once

#include <algorithm>
#include <set>
#include <string>
#include <vector>

#include "MenuKeys.h"

namespace Ardia::Menus {

struct HeldKey {
  WORD virtualKey;
  WORD scan;
  DWORD flags;
};

enum ModifierSide : unsigned {
  LeftShift = 1,
  RightShift = 2,
  LeftControl = 4,
  RightControl = 8,
  LeftAlt = 16,
  RightAlt = 32,
};

struct SideKey {
  unsigned side;
  WORD virtualKey;
  bool extended;
};

inline constexpr SideKey kSideKeys[] = {
    {LeftShift, VK_LSHIFT, false},
    {RightShift, VK_RSHIFT, false},
    {LeftControl, VK_LCONTROL, false},
    {RightControl, VK_RCONTROL, true},
    {LeftAlt, VK_LMENU, false},
    {RightAlt, VK_RMENU, true},
};

inline unsigned SideOfKey(UINT virtualKey, LPARAM flags) noexcept {
  bool extended = (flags & (1 << 24)) != 0;
  UINT scan = static_cast<UINT>((flags >> 16) & 0xFF);
  switch (virtualKey) {
    case VK_SHIFT: return scan == 0x36 ? RightShift : LeftShift;
    case VK_LSHIFT: return LeftShift;
    case VK_RSHIFT: return RightShift;
    case VK_CONTROL: return extended ? RightControl : LeftControl;
    case VK_LCONTROL: return LeftControl;
    case VK_RCONTROL: return RightControl;
    case VK_MENU: return extended ? RightAlt : LeftAlt;
    case VK_LMENU: return LeftAlt;
    case VK_RMENU: return RightAlt;
    default: return 0;
  }
}

template <typename Read>
inline unsigned SidesFrom(Read read) noexcept {
  unsigned sides = 0;
  for (SideKey const &key : kSideKeys) {
    if (read(key.virtualKey) & 0x8000) sides |= key.side;
  }
  return sides;
}

inline unsigned ThreadSides() noexcept {
  return SidesFrom([](int key) { return GetKeyState(key); });
}

inline unsigned PhysicalSides() noexcept {
  return SidesFrom([](int key) { return GetAsyncKeyState(key); });
}

inline unsigned ModifiersOfSides(unsigned sides) noexcept {
  unsigned modifiers = 0;
  if (sides & (LeftShift | RightShift)) modifiers |= ModifierShift;
  if (sides & (LeftControl | RightControl)) modifiers |= ModifierControl;
  if (sides & (LeftAlt | RightAlt)) modifiers |= ModifierOption;
  return modifiers;
}

struct TypeAheadHold {
  std::string windowId;
  HWND root = nullptr;
  unsigned startSides = 0;
  unsigned sides = 0;
  ULONGLONG startedAt = 0;
  bool replaying = false;
  size_t outstanding = 0;
  std::vector<HeldKey> keys;
  std::set<UINT> down;
};

inline HWND RootOf(HWND window) noexcept {
  return window ? GetAncestor(window, GA_ROOT) : nullptr;
}

}
