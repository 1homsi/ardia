import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { flatColors, gradientFill } from "../../../../packages/expo-windows/src/views/gradientFill.ts";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("a Surface's fill colours become positioned stops, with the fade passed through", () => {
  const filled = gradientFill({ fillColors: ["#ff000000", "#ff000080", "#ff0000ff"], fillStops: [0, 0.4, 1], fade: [1, 0.5, 0], fadeStops: [0, 0.8, 1] });
  assert.deepEqual(filled.stops, [[1, 0, 0, 0], [1, 0, 0, 128 / 255], [1, 0, 0, 1]]);
  assert.deepEqual(filled.places, [0, 0.4, 1]);
  assert.deepEqual(filled.fade, [1, 0.5, 0]);
  assert.deepEqual(filled.fadePlaces, [0, 0.8, 1]);
  assert.deepEqual(flatColors(filled.stops), [1, 0, 0, 0, 1, 0, 0, 128 / 255, 1, 0, 0, 1]);
});

test("stops that don't match their colours are spaced evenly, as the Mac's CAGradientLayer does with nil locations", () => {
  const filled = gradientFill({ fillColors: ["#000", "#fff"], fillStops: [0, 0.5, 1], fade: [1, 0], fadeStops: [0.2] });
  assert.equal(filled.places, undefined);
  assert.equal(filled.fadePlaces, undefined);
  assert.deepEqual(filled.fade, [1, 0]);
});

test("a solid fill fades too, as the Mac masks the whole plate; no gradient without two colours or a fade", () => {
  assert.deepEqual(gradientFill({ fill: "#00ff00", fade: [1, 0] }), { stops: [[0, 1, 0, 1], [0, 1, 0, 1]], places: undefined, fade: [1, 0], fadePlaces: undefined });
  assert.equal(gradientFill({ fill: "#00ff00" }), null);
  assert.equal(gradientFill({ fillColors: ["#fff"] }), null);
  assert.equal(gradientFill({ fillColors: ["#fff", "not a colour"] }), null);
  assert.equal(gradientFill({ fill: "#fff", fade: [1] }), null);
});

test("Windows draws the fill top to bottom and the fade left to right, as Surface.swift does", () => {
  const mac = source("../../../../packages/shell/ios/Surface.swift");
  assert.match(mac, /fillGradient\.startPoint = CGPoint\(x: 0\.5, y: flipped \? 0 : 1\)\n\s+fillGradient\.endPoint = CGPoint\(x: 0\.5, y: flipped \? 1 : 0\)/);
  assert.match(mac, /fadeMask\.startPoint = CGPoint\(x: 0, y: 0\.5\)\n\s+fadeMask\.endPoint = CGPoint\(x: 1, y: 0\.5\)/);
  assert.match(mac, /plate\.mask = fadeMask/);
  const surface = source("../../../../packages/expo-windows/src/views/Surface.tsx");
  assert.match(surface, /const TOP_TO_BOTTOM = 180;\nconst LEFT_TO_RIGHT = 90;/);
  assert.match(surface, /angle=\{TOP_TO_BOTTOM\}/);
  assert.match(surface, /fadeAngle=\{LEFT_TO_RIGHT\}/);
});

test("the native gradient places its stops and masks itself with the fade's alpha", () => {
  const view = source("../../windows/Ardia/GradientView.h");
  assert.match(view, /m_masked = m_compositor\.CreateMaskBrush\(\);\n\s+m_masked\.Source\(m_gradient\);\n\s+m_masked\.Mask\(m_mask\);/);
  assert.match(view, /Materials::ColorFromUnit\(0, 0, 0, alpha\)/);
  assert.match(view, /GradientParts::StopAt\(m_stops, i, count\)/);
  assert.match(view, /GradientParts::StopAt\(m_fadeStops, i, m_fade\.size\(\)\)/);
  assert.match(source("../../windows/Ardia/MaterialsModule.h"), /masked\.Mask\(fade\);/);
  const project = source("../../windows/Ardia/Ardia.vcxproj");
  for (const header of ["GradientView.h", "MaterialViewParts.h"]) assert.ok(project.includes(`<ClInclude Include="${header}" />`), header);
});

test("a gradient-only Surface cuts no page window: every GradientFill sits inside a toolbar or sidebar plate that does", () => {
  const surface = source("../../../../packages/expo-windows/src/views/Surface.tsx");
  assert.match(surface, /const own = gradient \? \{ ref, onLayout \} : \{ ref: cover\.ref, onLayout: cover\.onLayout \};/);
  const users = ["../components/toolbar/FieldLoadFill.tsx"];
  for (const file of users) assert.match(source(file), /<GradientFill /);
  const anywhere = ["../components/toolbar/Toolbar.tsx", "../components/littleArdia/SmallChrome.tsx", "../components/window/PageOverlays.tsx", "../components/window/LoadingPill.tsx"];
  for (const file of anywhere) assert.doesNotMatch(source(file), /<GradientFill /, `${file} draws a GradientFill of its own`);
});
