#import "ArdiaHLSVideoInternal.h"

using namespace ardia_runtime;
using namespace ardia_web_view;
using namespace ardia_hls_video;

static void *kPossibleContext = &kPossibleContext;

@implementation ArdiaHLSVideoSession (PictureInPicture)

- (void)preparePictureInPicture {
  if (_pip || !_layer || !_showing || !_view.window || ![AVPictureInPictureController isPictureInPictureSupported]) return;
  _pip = [[AVPictureInPictureController alloc] initWithPlayerLayer:_layer];
  _pip.delegate = self;
  [_pip addObserver:self forKeyPath:@"pictureInPicturePossible" options:NSKeyValueObservingOptionNew context:kPossibleContext];
  Trace(@"pip controller ready: possible=%d", _pip.pictureInPicturePossible);
}

- (void)dropPictureInPicture {
  if (!_pip) return;
  [_pip removeObserver:self forKeyPath:@"pictureInPicturePossible" context:kPossibleContext];
  [_pip stopPictureInPicture];
  _pip.delegate = nil;
  _pip = nil;
  _pipWanted = NO;
  if (_inPip) {
    _inPip = NO;
    [self deliverPictureInPicture];
  }
}

- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object change:(NSDictionary *)change context:(void *)context {
  if (context != kPossibleContext) return [super observeValueForKeyPath:keyPath ofObject:object change:change context:context];
  dispatch_async(dispatch_get_main_queue(), ^{
    if (!self->_pip) return;
    Trace(@"pip possible=%d", self->_pip.pictureInPicturePossible);
    if (self->_pipWanted && self->_pip.pictureInPicturePossible && !self->_pip.pictureInPictureActive) [self->_pip startPictureInPicture];
  });
}

- (BOOL)startPictureInPicture {
  if (![self active]) return NO;
  [self preparePictureInPicture];
  if (!_pip) return NO;
  if (_pip.pictureInPictureActive) return YES;
  _pipWanted = YES;
  _pipAskedAt = CACurrentMediaTime();
  if (_pip.pictureInPicturePossible) [_pip startPictureInPicture];
  __weak ArdiaHLSVideoSession *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kPictureInPictureDeadline * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    ArdiaHLSVideoSession *session = weakSelf;
    if (!session || !session->_pipWanted || session->_pip.pictureInPictureActive) return;
    Trace(@"pip never became possible");
    session->_pipWanted = NO;
    [session deliverPictureInPicture];
  });
  return YES;
}

- (void)exitPictureInPicture {
  _pipWanted = NO;
  Trace(@"pip exit: active=%d", _pip.pictureInPictureActive);
  if (_pip.pictureInPictureActive) [_pip stopPictureInPicture];
  __weak ArdiaHLSVideoSession *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kPictureInPictureDeadline * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    ArdiaHLSVideoSession *session = weakSelf;
    if (!session || !session->_inPip || session->_pipWanted) return;
    Trace(@"pip stop never finished");
    [session dropPictureInPicture];
    [session place];
  });
}

- (void)deliverPictureInPicture {
  if (_media) [self deliver:@{@"event" : @"pip", @"media" : @(_media), @"active" : @(_inPip)}];
}

- (void)pictureInPictureControllerDidStartPictureInPicture:(AVPictureInPictureController *)controller {
  Trace(@"pip started after %.0f ms", _pipWanted ? (CACurrentMediaTime() - _pipAskedAt) * 1000 : 0);
  _pipWanted = NO;
  _inPip = YES;
  [self place];
  [self deliverPictureInPicture];
}

- (void)pictureInPictureControllerDidStopPictureInPicture:(AVPictureInPictureController *)controller {
  Trace(@"pip stopped");
  _inPip = NO;
  [self place];
  [self deliverPictureInPicture];
}

- (void)pictureInPictureController:(AVPictureInPictureController *)controller failedToStartPictureInPictureWithError:(NSError *)error {
  Trace(@"pip failed: %@", error.localizedDescription);
  _pipWanted = NO;
  _inPip = NO;
  [self deliverPictureInPicture];
}

- (void)pictureInPictureController:(AVPictureInPictureController *)controller
    restoreUserInterfaceForPictureInPictureStopWithCompletionHandler:(void (^)(BOOL))completionHandler {
  completionHandler(YES);
}

@end
