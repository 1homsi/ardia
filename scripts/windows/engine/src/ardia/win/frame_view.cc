#include "ardia/win/frame_view.h"

#include <windows.h>

#include <dwmapi.h>

#include <cmath>

#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/display/win/screen_win.h"
#include "ui/views/widget/widget.h"
#include "ui/views/win/hwnd_util.h"

namespace ardia_win {

namespace {

const wchar_t* ResizeCursor(int hit) {
  if (hit == HTTOPLEFT) {
    return IDC_SIZENWSE;
  }
  if (hit == HTTOPRIGHT) {
    return IDC_SIZENESW;
  }
  return IDC_SIZENS;
}

}

int AppWindowTopEdgeHit(HWND page, POINT screen) {
  HWND app = page ? ::GetWindow(page, GW_OWNER) : nullptr;
  if (!app || ::IsZoomed(app) || ::IsIconic(app) ||
      !(::GetWindowLongPtrW(app, GWL_STYLE) & WS_THICKFRAME)) {
    return HTCLIENT;
  }
  RECT shown;
  if (FAILED(::DwmGetWindowAttribute(app, DWMWA_EXTENDED_FRAME_BOUNDS, &shown,
                                     sizeof(shown))) &&
      !::GetWindowRect(app, &shown)) {
    return HTCLIENT;
  }
  const UINT dpi = ::GetDpiForWindow(app);
  const int band = ::GetSystemMetricsForDpi(SM_CYSIZEFRAME, dpi) +
                   ::GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi);
  if (screen.y < shown.top || screen.y >= shown.top + band ||
      screen.x < shown.left || screen.x >= shown.right) {
    return HTCLIENT;
  }
  if (screen.x < shown.left + band) {
    return HTTOPLEFT;
  }
  if (screen.x >= shown.right - band) {
    return HTTOPRIGHT;
  }
  return HTTOP;
}

HostedFrameView::HostedFrameView(BrowserWidget* widget,
                                 BrowserView* browser_view)
    : BrowserFrameView(widget, browser_view) {}

HostedFrameView::~HostedFrameView() = default;

int HostedFrameView::GetTopInset(bool restored) const {
  return 0;
}

void HostedFrameView::UpdateThrobber(bool running) {}

gfx::Rect HostedFrameView::GetBoundsForClientView() const {
  return bounds();
}

gfx::Rect HostedFrameView::GetWindowBoundsForClientBounds(
    const gfx::Rect& client_bounds) const {
  return client_bounds;
}

int HostedFrameView::NonClientHitTest(const gfx::Point& point) {
  HWND page = views::HWNDForWidget(GetWidget());
  if (!page) {
    return HTCLIENT;
  }
  const float scale = display::win::GetScreenWin()->GetScaleFactorForHWND(page);
  POINT screen = {static_cast<LONG>(std::floor(point.x() * scale)),
                  static_cast<LONG>(std::floor(point.y() * scale))};
  ::ClientToScreen(page, &screen);
  const int hit = AppWindowTopEdgeHit(page, screen);
  if (hit != HTCLIENT) {
    ::SetCursor(::LoadCursorW(nullptr, ResizeCursor(hit)));
  }
  return hit;
}

std::unique_ptr<BrowserFrameView> CreateHostedFrameView(
    BrowserWidget* widget,
    BrowserView* browser_view) {
  return std::make_unique<HostedFrameView>(widget, browser_view);
}

BEGIN_METADATA(HostedFrameView)
END_METADATA

}
