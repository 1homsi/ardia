#include "ardia/win/frame_view.h"

#include <windows.h>

#include <cmath>

#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/display/win/screen_win.h"
#include "ui/views/widget/widget.h"
#include "ui/views/win/hwnd_util.h"

namespace ardia_win {

bool AppWindowResizesFromTop(HWND page, POINT screen) {
  HWND app = page ? ::GetWindow(page, GW_OWNER) : nullptr;
  if (!app) {
    return false;
  }
  const LRESULT hit = ::SendMessageW(
      app, WM_NCHITTEST, 0,
      MAKELPARAM(static_cast<short>(screen.x), static_cast<short>(screen.y)));
  return hit == HTTOP || hit == HTTOPLEFT || hit == HTTOPRIGHT;
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
  return AppWindowResizesFromTop(page, screen) ? HTTRANSPARENT : HTCLIENT;
}

std::unique_ptr<BrowserFrameView> CreateHostedFrameView(
    BrowserWidget* widget,
    BrowserView* browser_view) {
  return std::make_unique<HostedFrameView>(widget, browser_view);
}

BEGIN_METADATA(HostedFrameView)
END_METADATA

}
