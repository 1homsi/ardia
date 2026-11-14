import assert from "node:assert/strict";
import { test } from "node:test";

const { DeviceEventEmitter, turboModules } = await import("../test-native/reactNative.ts");
const native = { gradient: true };
turboModules.ArdiaMaterials = {
  capabilities: () => ({ build: 22631, systemBackdrop: true, systemBackdropSupported: true, inWindowBlur: true, gradient: native.gradient, background: true }),
};
const capabilities = await import("../../../../packages/expo-windows/src/views/materialCapabilities.ts");

const brushFails = () => {
  native.gradient = false;
  DeviceEventEmitter.emit(capabilities.GRADIENT_FAILED_EVENT, {});
};

test("while the native brush draws, a mounted layer hears nothing and keeps drawing", () => {
  let switched = 0;
  const stop = capabilities.onGradientFailure(() => switched++);
  assert.equal(capabilities.gradientDrawsNow(), true);
  assert.equal(switched, 0);
  stop();
});

test("reproduction: without the native report, the cached answer stays true after the brush fails", () => {
  capabilities.materialCapabilities();
  native.gradient = false;
  assert.equal(capabilities.nativeGradient(), true, "what GradientLayer read before #1877, so it kept an empty native view");
  native.gradient = true;
});

test("a brush that fails at any later moment switches every mounted layer to the stripes and corrects the cache", async () => {
  const told = [];
  const first = capabilities.onGradientFailure(() => told.push("first"));
  const second = capabilities.onGradientFailure(() => told.push("second"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(told, [], "nothing before the failure");
  brushFails();
  assert.deepEqual(told, ["first", "second"], "both layers switch when native reports it, however late");
  assert.equal(capabilities.nativeGradient(), false, "and every later gradient starts striped");
  first();
  second();
});

test("a layer that unmounts first is told nothing when a brush fails later", () => {
  let told = 0;
  const stop = capabilities.onGradientFailure(() => told++);
  stop();
  const keeper = capabilities.onGradientFailure(() => {});
  DeviceEventEmitter.emit(capabilities.GRADIENT_FAILED_EVENT, {});
  assert.equal(told, 0);
  keeper();
});

test("a layer that mounts after the failure starts striped without waiting for an event", () => {
  assert.equal(capabilities.gradientDrawsNow(), false);
});
