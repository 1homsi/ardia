import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const script = readFileSync(new URL("../../../../packages/ardiacore/ios/page_script.js", import.meta.url), "utf8");
const define = (name, pattern, uses = {}) => {
  const source = script.match(pattern)?.[1];
  assert.ok(source, `page_script.js defines ${name}`);
  return new Function(...Object.keys(uses), `return ${source}`)(...Object.values(uses));
};
const clockPosition = define("clockPosition", /const clockPosition = (\(rate, clock, now\) => \{[\s\S]*?\n {2}\});\n/);
const timelineNow = define("timelineNow", /const timelineNow = (\(reported, mediaAdvance, now\) => \{[\s\S]*?\n {2}\});\n/, { clockPosition });
const mediaAdvanceOf = define("mediaAdvanceOf", /const mediaAdvanceOf = (\(el, timeline\) => .*);\n/);
const anchorStartedMedia = define("anchorStartedMedia", /const anchorStartedMedia = (\(timeline, m, now\) => \{[\s\S]*?\n {2}\});\n/, { clockPosition });
const timelineReport = define("timelineReport", /const timelineReport = (\(timeline, el, now\) => \{[\s\S]*?\n {2}\});\n/, { mediaAdvanceOf, timelineNow });

const video = (currentTime, playbackRate = 1) => ({ currentTime, playbackRate });
const setAt = (position, { playing = true, playbackRate = 1, media = [] } = {}) => ({
  position,
  duration: 200,
  playbackRate,
  clock: { position, at: 0, advancing: playing },
  mediaTimes: new WeakMap(media.map(([el, at]) => [el, at])),
});

test("a site that set its position once is reported where it has played to since, not where it set it", () => {
  const el = video(110);
  assert.deepEqual(timelineReport(setAt(30, { media: [[el, 100]] }), el, 10_000), { position: 40, playbackRate: 1 });
  assert.deepEqual(timelineReport(setAt(30), null, 10_000), { position: 40, playbackRate: 1 }, "with no element to follow, its clock moves on");
});

test("a site's position stands still while it says it is paused", () => {
  assert.equal(timelineReport(setAt(30, { playing: false }), null, 10_000).position, 30);
});

test("the reported rate is the one the position moves at, so the card counts at the same speed", () => {
  const fast = video(110, 2);
  assert.deepEqual(timelineReport(setAt(30, { media: [[fast, 100]] }), fast, 5_000), { position: 40, playbackRate: 2 }, "following the element, its rate");
  assert.deepEqual(timelineReport(setAt(30, { playbackRate: 1.5 }), video(0, 2), 10_000), { position: 45, playbackRate: 1.5 }, "following the clock, the site's rate");
});

test("a site's position never runs past its duration or below zero", () => {
  assert.equal(timelineReport(setAt(195), null, 60_000).position, 200);
  const el = video(0);
  assert.equal(timelineReport(setAt(3, { media: [[el, 10]] }), el, 0).position, 0);
});

test("media that starts playing after the site set its position counts from where it starts, not from the site's clock", () => {
  const timeline = setAt(0);
  const audio = video(0);
  assert.equal(timelineReport(timeline, audio, 20_000).position, 20, "unseen, it follows the clock that ran while nothing played");
  timeline.started = false;
  timeline.clock = { position: 20, at: 20_000, advancing: true };
  assert.equal(anchorStartedMedia(timeline, audio, 20_000), 0, "even after the site said it plays, before anything did");
  assert.equal(timelineReport(timeline, audio, 20_000).position, 0);
  audio.currentTime = 5;
  assert.equal(timelineReport(timeline, audio, 25_000).position, 5);
});

test("media that starts while the site's position is already playing picks up where its clock is, and media already followed isn't moved", () => {
  const next = video(0);
  const timeline = setAt(30);
  timeline.started = true;
  assert.equal(anchorStartedMedia(timeline, next, 10_000), 40);
  next.currentTime = 2;
  assert.equal(timelineReport(timeline, next, 12_000).position, 42);
  assert.equal(anchorStartedMedia(timeline, next, 20_000), null);
});
