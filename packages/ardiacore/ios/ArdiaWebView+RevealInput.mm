#import "ArdiaWebViewInternal.h"
#import "ArdiaFieldTiming.h"

#import <QuartzCore/QuartzCore.h>

using namespace ardia_web_view;

namespace {

NSString *const kPageIdentityTag = @"page-identity";
constexpr NSEventMask kButtonDowns = NSEventMaskLeftMouseDown | NSEventMaskRightMouseDown | NSEventMaskOtherMouseDown;
constexpr NSEventMask kButtonUps = NSEventMaskLeftMouseUp | NSEventMaskRightMouseUp | NSEventMaskOtherMouseUp;
constexpr NSEventMask kButtonDrags = NSEventMaskLeftMouseDragged | NSEventMaskRightMouseDragged | NSEventMaskOtherMouseDragged;
constexpr NSEventMask kKeys = NSEventMaskKeyDown | NSEventMaskKeyUp | NSEventMaskFlagsChanged;
constexpr NSEventMask kPointer = NSEventMaskMouseMoved | NSEventMaskScrollWheel | NSEventMaskMagnify | NSEventMaskSmartMagnify | NSEventMaskSwipe | NSEventMaskRotate;

NSUInteger gOnScreenAhead = 0;
NSUInteger gSwallowedButtons = 0;

void CollectPageIdentity(NSView *root, NSHashTable<NSView *> *found) {
  for (NSView *view in root.subviews) {
    if ([ReactTagOf(view) isEqualToString:kPageIdentityTag]) [found addObject:view];
    else CollectPageIdentity(view, found);
  }
}

}

namespace ardia_web_view {

const NSEventMask kRevealInputMask = kButtonDowns | kButtonUps | kButtonDrags | kKeys | kPointer;

NSString *ReactTagOf(NSView *view) {
  for (NSString *name in @[ @"nativeID", @"nativeId" ]) {
    if (![view respondsToSelector:NSSelectorFromString(name)]) continue;
    id tag = [view valueForKey:name];
    if ([tag isKindOfClass:NSString.class]) return tag;
  }
  return nil;
}

}

@implementation ArdiaWebView (RevealInput)

static BOOL InTabPage(id responder) {
  for (NSView *view = [responder isKindOfClass:NSView.class] ? responder : nil; view; view = view.superview)
    if ([view isKindOfClass:ArdiaWebView.class]) return !((ArdiaWebView *)view)->_standalone;
  return NO;
}

+ (ArdiaWebView *)onScreenAheadIn:(NSWindow *)window {
  if (!gOnScreenAhead || !window) return nil;
  for (ArdiaWebView *other in LiveViews().allObjects)
    if (other.window == window && other->_reveal.onScreen) return other;
  return nil;
}

+ (BOOL)swallowsAheadOfSwitch:(NSEvent *)event {
  if (!gOnScreenAhead && !gSwallowedButtons) return NO;
  const NSEventMask type = NSEventMaskFromType(event.type);
  if (type & (kButtonUps | kButtonDrags)) {
    const NSUInteger button = 1u << event.buttonNumber;
    if (!(gSwallowedButtons & button)) return NO;
    if (type & kButtonUps) gSwallowedButtons &= ~button;
    return YES;
  }
  NSWindow *window = event.window;
  if (![ArdiaWebView onScreenAheadIn:window]) return NO;
  if (type & kKeys) return InTabPage(window.firstResponder);
  if (!InTabPage(HitInWindow(event))) return NO;
  if (type & kButtonDowns) gSwallowedButtons |= 1u << event.buttonNumber;
  return YES;
}

- (void)noteOnScreenAhead:(BOOL)overAnother {
  if (!_reveal.native) return;
  const BOOL painted = !_frameHold.awaiting && self.alphaValue >= 1;
  if (!_reveal.onScreen && (painted || overAnother)) {
    _reveal.onScreen = YES;
    gOnScreenAhead++;
    [self hidePageIdentity];
  }
  if (!painted || _reveal.painted) return;
  _reveal.painted = YES;
  ArdiaFieldMarkNow([NSString stringWithFormat:@"press:%lu", (unsigned long)_reveal.press], @"nativeReveal");
  ArdiaFieldMarkAtCommit(_transferKey, @"view");
}

+ (void)focusPagesAskedAheadOfSwitch {
  for (ArdiaWebView *view in LiveViews().allObjects) {
    if ([ArdiaWebView onScreenAheadIn:view.window]) continue;
    if (view->_visible && view->_focus.onActivate) [view schedulePainting];
    if (!view->_focus.askedAheadOfSwitch) continue;
    view->_focus.askedAheadOfSwitch = NO;
    if (view->_visible) [view focusPage];
    else [ArdiaWebView focusVisiblePageIn:view.window];
  }
}

- (void)leaveScreenAhead {
  if (!_reveal.onScreen) return;
  _reveal.onScreen = NO;
  gOnScreenAhead--;
  NSMapTable<NSView *, NSNumber *> *hidden = _reveal.identityHidden;
  _reveal.identityHidden = nil;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  for (NSView *view in hidden.keyEnumerator.allObjects) view.alphaValue = [hidden objectForKey:view].doubleValue;
  [CATransaction commit];
  dispatch_async(dispatch_get_main_queue(), ^{
    [ArdiaWebView focusPagesAskedAheadOfSwitch];
  });
}

- (void)hidePageIdentity {
  NSView *content = self.window.contentView;
  if (!content) return;
  NSMapTable<NSView *, NSNumber *> *hidden = _reveal.identityHidden ?: [NSMapTable weakToStrongObjectsMapTable];
  NSHashTable<NSView *> *found = [NSHashTable weakObjectsHashTable];
  CollectPageIdentity(content, found);
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  for (NSView *view in found.allObjects) {
    if (![hidden objectForKey:view]) [hidden setObject:@(view.alphaValue) forKey:view];
    view.alphaValue = 0;
  }
  [CATransaction commit];
  _reveal.identityHidden = hidden;
}

- (void)hidePageIdentityAfterMount {
  __weak ArdiaWebView *weakSelf = self;
  const NSUInteger generation = _reveal.generation;
  CFRunLoopObserverRef observer = CFRunLoopObserverCreateWithHandler(nil, kCFRunLoopBeforeWaiting | kCFRunLoopExit, false, 0, ^(CFRunLoopObserverRef, CFRunLoopActivity) {
    ArdiaWebView *view = weakSelf;
    if (view && view->_reveal.onScreen && view->_reveal.generation == generation) [view hidePageIdentity];
  });
  CFRunLoopAddObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes);
  CFRelease(observer);
}

@end
