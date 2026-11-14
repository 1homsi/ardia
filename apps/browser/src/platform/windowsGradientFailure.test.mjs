import assert from "node:assert/strict";
import { mock, test } from "node:test";

const { turboModules } = await import("../test-native/reactNative.ts");
const native = { gradient: true };
turboModules.ArdiaMaterials = {
  capabilities: () => ({ build: 22631, systemBackdrop: true, systemBackdropSupported: true, inWindowBlur: true, gradient: native.gradient, background: true }),
};
const capabilities = await import("../../../../packages/expo-windows/src/views/materialCapabilities.ts");

function withTimers(run) {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    run();
  } finally {
    mock.timers.reset();
  }
}

test("a gradient that keeps drawing never switches to the stripes", () => {
  withTimers(() => {
    let switched = 0;
    capabilities.watchGradientFailure(() => switched++);
    mock.timers.tick(capabilities.GRADIENT_RECHECK_MS + 1);
    assert.equal(switched, 0);
    assert.equal(capabilities.gradientDrawsNow(), true);
  });
});

test("reproduction: a brush that fails after the capability answered true leaves the cached answer at true", () => {
  assert.equal(capabilities.nativeGradient(), true, "the first answer is cached");
  native.gradient = false;
  assert.equal(capabilities.nativeGradient(), true, "GradientLayer read only this before the fix, so it kept the empty native view and drew no glow");
});

test("the layer asks native again shortly after it mounts and switches to the stripes, and the cache follows", () => {
  withTimers(() => {
    let switched = 0;
    capabilities.watchGradientFailure(() => switched++);
    mock.timers.tick(capabilities.GRADIENT_RECHECK_MS - 1);
    assert.equal(switched, 0, "not before the recheck");
    mock.timers.tick(1);
    assert.equal(switched, 1, "the layer is told to draw the stripes");
    assert.equal(capabilities.nativeGradient(), false, "and every later gradient starts striped");
    assert.equal(capabilities.gradientDrawsNow(), false);
  });
});

test("a layer that goes away before the recheck isn't told anything", () => {
  withTimers(() => {
    let switched = 0;
    const stop = capabilities.watchGradientFailure(() => switched++);
    stop();
    mock.timers.tick(capabilities.GRADIENT_RECHECK_MS + 1);
    assert.equal(switched, 0);
  });
});
