import assert from "node:assert/strict";
import test from "node:test";
import { launchTrayFrames, tabFaceDecodesAtDrawnSize } from "./launchTray.ts";

test("the launch tray waits two frames only in an Android lab build that asks for it with ArdiaDeferLaunchTray", () => {
  assert.equal(launchTrayFrames("android", true, true), 2);
  assert.equal(launchTrayFrames("android", true, false), 0);
  assert.equal(launchTrayFrames("android", false, true), 0);
  assert.equal(launchTrayFrames("ios", true, true), 0);
});

test("deck pictures decode at their drawn size only in an Android lab build that asks for it with ArdiaTabFaceResize", () => {
  assert.equal(tabFaceDecodesAtDrawnSize("android", true, true), true);
  assert.equal(tabFaceDecodesAtDrawnSize("android", false, true), false);
  assert.equal(tabFaceDecodesAtDrawnSize("ios", true, true), false);
  assert.equal(tabFaceDecodesAtDrawnSize("android", true, false), false);
});
