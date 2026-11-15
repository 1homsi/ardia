import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const WIDTH = 1280;
const HEIGHT = 640;

function makeMeasure(ctx, inst, out) {
  let shot = 0;
  return async function measure(id, label, { hits = true } = {}) {
    const png = join(out, `.m-${label}-${shot++}.png`);
    const data = await inst.eval(
      `${ctx.HELPERS}
const id = ${JSON.stringify(id)};
const s = st();
const w = s.windows[id];
return D.devSnapshotWindow(id, ${JSON.stringify(png)}, false).then((ok) => D.devSetWindowFrame(id, [40 + Object.keys(s.windows).indexOf(id) * 11, 60 + Object.keys(s.windows).indexOf(id) * 7, w.frame[2], ${HEIGHT}]))
  .then((frame) => ${hits} ? nativeOf(frame).then((n) => hitRow(n, Math.round(frame[2]), ${21})) : [])
  .then((hits) => {
    const order = stripOrder(id);
    return { codes: hits.map(classify).join(""), order, loose: order.filter((t) => !s.tabs[t].pin), pins: order.filter((t) => s.tabs[t].pin),
      active: w.activeTabIds[w.profileId], favicons: Object.fromEntries(order.map((t) => [t, s.tabs[t].favicon])), discarded: [], width: w.frame[2] };
  });`,
      { timeout: 120000 },
    );
    const img = ctx.readPng(png);
    rmSync(png, { force: true });
    if (!hits) data.codes = "S".repeat(Math.round(data.width));
    const m = ctx.analyse(img, img.width / data.width, data, data.width);
    const favX = Object.fromEntries(m.detail.favs.filter((f) => f[2]).map(([t, x]) => [t, x]));
    return { ...m, favX, active: data.active, count: data.loose.length, img };
  };
}

function savePng(ctx, img, path, height = 48) {
  const h = Math.min(height, img.height);
  writeFileSync(path, ctx.encodePng({ width: img.width, height: h, rgba: Buffer.from(img.rgba.subarray(0, img.width * 4 * h)) }));
}

async function burst(ctx, inst, id, dir, ms, action) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return inst.eval(
    `${ctx.HELPERS}
const id = ${JSON.stringify(id)};
const w = st().windows[id];
const shots = D.devSnapshotBurst(id, ${JSON.stringify(dir)}, [0, 0, w.frame[2], 48], ${ms});
return new Promise((r) => setTimeout(r, 60)).then(() => { ${action} }).then(() => shots).then((frames) => (frames || []).map((f) => f[1]));`,
    { timeout: 60000 },
  );
}

function stripFrames(dir, outPng, every = 2) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
  if (!files.length) return 0;
  const pick = files.filter((_, i) => i % every === 0).slice(0, 24);
  const args = ["-y", "-loglevel", "error", ...pick.flatMap((f) => ["-i", join(dir, f)]), "-filter_complex", `${pick.map((_, i) => `[${i}]`).join("")}vstack=inputs=${pick.length}`, outPng];
  if (pick.length === 1) execFileSync("cp", [join(dir, pick[0]), outPng]);
  else execFileSync("ffmpeg", args);
  try {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "60", "-pattern_type", "glob", "-i", join(dir, "f*.png"), "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-pix_fmt", "yuv420p", outPng.replace(/\.png$/, ".mp4")]);
  } catch {}
  return files.length;
}

export async function runInteractions(ctx) {
  const out = ctx.out;
  mkdirSync(join(out, "frames"), { recursive: true });
  const only = ctx.flag("only") ? new RegExp(ctx.flag("only")) : null;
  const server = await ctx.startServer();
  const port = server.address().port;
  const inst = await ctx.launch(ctx.app, { data: join(out, ".data", "interact"), fresh: true, session: ctx.familySession("counts", port), onboarded: true, startTimeout: 120000 });
  const run = (body, timeout = 60000) => inst.eval(`${ctx.HELPERS}\n${body}`, { timeout });
  const measure = makeMeasure(ctx, inst, out);
  const results = {};
  const record = (name, value) => {
    results[name] = value;
    console.log(`${name.padEnd(34)} ${JSON.stringify(value, (k, v) => (k === "img" ? undefined : v))}`);
    writeFileSync(join(out, "interact.json"), JSON.stringify(results, (k, v) => (k === "img" ? undefined : v), 1));
  };
  const want = (name) => !only || only.test(name);
  const prepare = (id, width, selIndex) =>
    run(`const id = ${JSON.stringify(id)}; const loose = stripOrder(id).filter((t) => !st().tabs[t].pin);
      st().updateSettings({ appearance: "dark" });
      ac.actions.switchToTab(loose[${selIndex === "mid" ? "Math.floor(loose.length / 2)" : selIndex}]);
      return D.devSetWindowFrame(id, [40 + Object.keys(st().windows).indexOf(id) * 11, 60 + Object.keys(st().windows).indexOf(id) * 7, ${width}, ${HEIGHT}])
        .then(() => D.devSetPointer(id, ${width} / 2, 400, true)).then(() => wait(1200)).then(() => frames(3)).then(() => loose.length);`);
  const command = (id, command, arg = null) => run(`ac.runCommand({ command: ${JSON.stringify(command)}, arg: ${JSON.stringify(arg)}, windowId: ${JSON.stringify(id)} }); return wait(900).then(() => frames(3)).then(() => st().windows[${JSON.stringify(id)}].activeTabIds.default);`);
  try {
    await run(`return wait(4000);`);

    if (want("reveal")) {
      await prepare("c120", WIDTH, "mid");
      const frames = join(out, "frames", "reveal-far-left");
      await burst(ctx, inst, "c120", frames, 900, `const loose = stripOrder("c120"); ac.actions.switchToTab(loose[3]);`);
      const n = stripFrames(frames, join(out, "frames", "reveal-far-left.png"));
      await run(`return wait(400);`);
      const far = await measure("c120", "reveal");
      const rows = { menuPickFarLeft: far.selInView, frames: n };
      rows.cmd1 = (await command("c120", "selectTab", "1"), (await measure("c120", "cmd1")).selInView);
      rows.cmd9 = (await command("c120", "selectLastTab"), (await measure("c120", "cmd9")).selInView);
      await prepare("c120", WIDTH, 50);
      const steps = [];
      for (let i = 0; i < 14; i++) {
        await command("c120", "nextTab");
        const m = await measure("c120", `next${i}`, { hits: i === 13 });
        steps.push(m.favX[(await run(`return st().windows.c120.activeTabIds.default;`)).split("-").pop()] !== undefined ? 1 : 0);
      }
      rows.nextTab14 = steps;
      await prepare("c120", WIDTH, 100);
      rows.prevTab = [];
      for (let i = 0; i < 6; i++) {
        await command("c120", "previousTab");
        const m = await measure("c120", `prev${i}`, { hits: false });
        rows.prevTab.push(m.favX[(await run(`return st().windows.c120.activeTabIds.default;`)).split("-").pop()] !== undefined ? 1 : 0);
      }
      record("reveal", rows);
    }

    if (want("newtab")) {
      await prepare("c60", WIDTH, "mid");
      const before = await measure("c60", "nt0");
      const frames = join(out, "frames", "new-tab-full");
      await burst(ctx, inst, "c60", frames, 900, `ac.runCommand({ command: "newTab", arg: null, windowId: "c60" });`);
      stripFrames(frames, join(out, "frames", "new-tab-full.png"));
      await run(`return wait(500);`);
      const after = await measure("c60", "nt1");
      savePng(ctx, after.img, join(out, "frames", "new-tab-full-after.png"));
      const shape = after.detail.selSpan;
      record("newTabFull", { selShapeInView: shape[0] > after.detail.viewport[0] + 1 && shape[1] < after.detail.viewport[1] - 1 && shape[1] - shape[0] > 20 ? 1 : 0, newTabButton: after.newTab, beforeNewTab: before.newTab, selSpan: shape });
      await run(`ac.runCommand({ command: "closeTab", arg: null, windowId: "c60" }); return wait(800);`);
    }

    if (want("background")) {
      await prepare("c60", WIDTH, "mid");
      const before = await measure("c60", "bg0", { hits: false });
      await run(`const cur = st().windows.c60.activeTabIds.default; st().newTab("c60", { url: "http://127.0.0.1:${port}/page/c60/2", background: true, openerId: cur }); return wait(900);`);
      const after = await measure("c60", "bg1", { hits: false });
      savePng(ctx, before.img, join(out, "frames", "background-tab-before.png"));
      savePng(ctx, after.img, join(out, "frames", "background-tab-after.png"));
      record("backgroundTab", { selectedShift: after.detail.selSpan[0] - before.detail.selSpan[0], selInViewAfter: after.detail.selSpan[0] >= 0 ? 1 : 0, selTitleBefore: before.selTitlePt });
    }

    if (want("closeUnderPointer")) {
      for (const [id, width] of [["c60", WIDTH], ["c30", WIDTH], ["c15", 900], ["c15", 1728]]) {
        await prepare(id, width, "mid");
        const m0 = await measure(id, "cp0");
        const visible = m0.detail.tabs.filter(([t, a, b]) => a > m0.detail.viewport[0] + 30 && b < m0.detail.viewport[1] - 30 && `${id}-${t}` !== m0.active);
        const target = visible[Math.floor(visible.length / 2)] ?? visible[0];
        if (!target) {
          record(`closeUnderPointer.${id}`, { error: "no tab" });
          continue;
        }
        const x = target[2] - 6 - 11;
        const res = await run(`const id = ${JSON.stringify(id)};
          return D.devSetPointer(id, ${x}, 21, true).then(() => wait(450)).then(() => D.devSetWindowFrame(id, [40 + Object.keys(st().windows).indexOf(id) * 11, 60 + Object.keys(st().windows).indexOf(id) * 7, ${width}, ${HEIGHT}]))
            .then((frame) => nativeOf(frame)).then((n) => {
              const hitAt = () => ac.engine.call("windows.dev", { window: n, action: "hit:${x},21" });
              const closes = [];
              let chain0 = null;
              const step = (k) => k >= 5 ? Promise.resolve() : hitAt().then((h) => {
                if (k === 0) chain0 = h;
                const count = stripOrder(id).length;
                closes.push({ chain: h, sameAsClose: h === chain0 });
                return ac.engine.call("windows.dev", { window: n, action: "click:${x},21" }).then(() => wait(650)).then(() => { closes[k].closed = count - stripOrder(id).length; }).then(() => step(k + 1));
              });
              return step(0).then(() => hitAt()).then((h) => { closes.push({ chain: h, sameAsClose: h === chain0, final: true }); return closes; });
            });`, 90000);
        const isClose = !/FileDragView/.test(res[0].chain);
        const landed = res.slice(1).filter((c, k) => isClose && c.sameAsClose && (res[k].closed ?? 0) > 0).length;
        const closed = res.reduce((n, c) => n + (c.closed ?? 0), 0);
        const mAfter = await measure(id, "cp1", { hits: false });
        savePng(ctx, mAfter.img, join(out, "frames", `close-under-pointer-${id}.png`));
        record(`closeUnderPointer.${id}-${width}`, { closedOf5: closed, landedOf5: landed, startedOnClose: isClose });
        await run(`return D.devSetPointer(${JSON.stringify(id)}, ${width} / 2, 400, true).then(() => wait(700));`);
      }
    }

    if (want("closeEnds")) {
      const r = {};
      for (const end of ["start", "end"]) {
        await prepare("c30", WIDTH, end === "start" ? 0 : "loose.length - 1");
        const frames = join(out, "frames", `close-selected-${end}`);
        await burst(ctx, inst, "c30", frames, 700, `ac.runCommand({ command: "closeTab", arg: null, windowId: "c30" });`);
        stripFrames(frames, join(out, "frames", `close-selected-${end}.png`));
        await run(`return wait(500);`);
        const m = await measure("c30", `ce-${end}`);
        r[end] = { selInView: m.selInView, selTitlePt: m.selTitlePt, now: m.active };
      }
      record("closeSelectedAtEnds", r);
    }

    if (want("scroll")) {
      const r = {};
      for (const [kind, steps] of [
        ["wheelVertical", Array.from({ length: 6 }, () => ({ phase: "wheel", dy: -4 }))],
        ["wheelShift", Array.from({ length: 6 }, () => ({ phase: "wheel", dy: -4, shift: true }))],
        ["trackpadHorizontal", [{ phase: "began", dx: -8 }, ...Array.from({ length: 12 }, () => ({ phase: "changed", dx: -24 })), { phase: "ended", dx: 0 }, { phase: "momentumBegan", dx: -20 }, ...Array.from({ length: 10 }, (_, i) => ({ phase: "momentumChanged", dx: -18 + i * 1.6 })), { phase: "momentumEnded", dx: 0 }]],
        ["trackpadVertical", [{ phase: "began", dy: -8 }, ...Array.from({ length: 12 }, () => ({ phase: "changed", dy: -24 })), { phase: "ended", dy: 0 }]],
      ]) {
        await prepare("c120", WIDTH, "mid");
        const before = await measure("c120", `sc0-${kind}`, { hits: false });
        const sim = await run(`const w = st().windows.c120;
          return D.devSetWindowFrame("c120", [40 + Object.keys(st().windows).indexOf("c120") * 11, 60 + Object.keys(st().windows).indexOf("c120") * 7, w.frame[2], ${HEIGHT}]).then((frame) => nativeOf(frame))
            .then((n) => globalThis.expo.modules.ArdiaSwipe.devSimulate(640, 21, n, ${JSON.stringify(steps.map((s, i) => ({ ...s, timestampMs: i * 16 })))}, true)).then((r) => wait(900).then(() => r));`);
        const after = await measure("c120", `sc1-${kind}`, { hits: false });
        const common = Object.keys(before.favX).filter((t) => after.favX[t] !== undefined);
        const shift = common.length ? after.favX[common[0]] - before.favX[common[0]] : before.detail.tabs.length && after.detail.tabs.length ? NaN : 0;
        const firstBefore = before.detail.tabs[0]?.[0], firstAfter = after.detail.tabs[0]?.[0];
        r[kind] = { shiftPt: Number.isNaN(shift) ? `moved past (${firstBefore}→${firstAfter})` : shift, firstVisible: [firstBefore, firstAfter], sim: typeof sim === "object" ? Object.keys(sim ?? {}).slice(0, 4) : sim };
      }
      record("scroll", r);
    }

    if (want("edgeDrag")) {
      await prepare("c60", WIDTH, "mid");
      const m0 = await measure("c60", "ed0");
      const vis = m0.detail.tabs.filter(([, a]) => a > m0.detail.viewport[0] + 10);
      const grab = vis[1];
      const edge = m0.detail.viewport[1] - 6;
      const startX = Math.round((grab[1] + grab[2]) / 2);
      const pts = [[startX, 21], [startX + 12, 21], [startX + 60, 21]];
      for (let x = startX + 60; x < edge; x += 60) pts.push([x, 21]);
      for (let i = 0; i < 14; i++) pts.push([edge, 21]);
      const before = await run(`return stripOrder("c60").filter((t) => !st().tabs[t].pin).indexOf("c60-${grab[0]}");`);
      await run(`const w = st().windows.c60; return D.devSetWindowFrame("c60", [40 + Object.keys(st().windows).indexOf("c60") * 11, 60 + Object.keys(st().windows).indexOf("c60") * 7, w.frame[2], ${HEIGHT}]).then((frame) => nativeOf(frame))
        .then((n) => ac.engine.call("windows.dev", { window: n, action: "drag:${pts.map((p) => p.join(",")).join(";")}" })).then(() => wait(${pts.length * 12 * 16 + 1200}));`, 120000);
      const after = await run(`const at = () => stripOrder("c60").filter((t) => !st().tabs[t].pin).indexOf("c60-${grab[0]}");
        const until = Date.now() + 6000; const poll = () => at() !== ${before} || Date.now() > until ? at() : wait(150).then(poll); return poll();`, 30000);
      const m1 = await measure("c60", "ed1", { hits: false });
      savePng(ctx, m1.img, join(out, "frames", "edge-drag-after.png"));
      record("edgeDrag", { from: before, to: after, movedSlots: after - before, lastVisibleBefore: vis.at(-1)?.[0], grabbed: grab[0], startX, edge, viewport: m0.detail.viewport });
    }

    if (want("resize")) {
      await prepare("c120", 1728, 70);
      const wide = await measure("c120", "rs0");
      await run(`const w = st().windows.c120; return D.devSetWindowFrame("c120", [40 + Object.keys(st().windows).indexOf("c120") * 11, 60 + Object.keys(st().windows).indexOf("c120") * 7, 900, ${HEIGHT}]).then(() => wait(1200));`);
      const narrow = await measure("c120", "rs1");
      await run(`return D.devSetWindowFrame("c120", [40 + Object.keys(st().windows).indexOf("c120") * 11, 60 + Object.keys(st().windows).indexOf("c120") * 7, 1728, ${HEIGHT}]).then(() => wait(1200));`);
      const back = await measure("c120", "rs2");
      record("resize", { wide: wide.selInView, narrow: narrow.selInView, back: back.selInView, identifiableWide: wide.identifiable, identifiableNarrow: narrow.identifiable });
    }

    if (want("hover")) {
      await prepare("c120", WIDTH, "mid");
      const m0 = await measure("c120", "hv0");
      const t = m0.detail.tabs.find(([id, a]) => a > m0.detail.viewport[0] + 200 && `c120-${id}` !== m0.active);
      const centre = Math.round((t[1] + t[2]) / 2);
      const r = await run(`return D.devSetPointer("c120", ${centre}, 21, true).then(() => wait(1100)).then(() => {
          const h = ac.stripHover.useStripHover.getState().hover;
          const w = st().windows.c120;
          return D.devSetWindowFrame("c120", [40 + Object.keys(st().windows).indexOf("c120") * 11, 60 + Object.keys(st().windows).indexOf("c120") * 7, w.frame[2], ${HEIGHT}]).then((frame) => nativeOf(frame))
            .then((n) => Promise.all([ac.engine.call("windows.dev", { window: n, action: "hit:${t[2] - 17},21" }), ac.engine.call("windows.dev", { window: n, action: "hit:${centre},21" })]))
            .then(([closeHit, centreHit]) => ({ card: !!h, closeHit, centreHit }));
        });`);
      const shot = await measure("c120", "hv1", { hits: false });
      savePng(ctx, shot.img, join(out, "frames", "hover-min-width.png"), 120);
      record("hoverMinWidth", { card: r.card, tabWidth: t[2] - t[1], closeChain: r.closeHit.slice(0, 90), centreChain: r.centreHit.slice(0, 90) });
      await run(`return D.devSetPointer("c120", 640, 400, true).then(() => wait(600));`);
    }
  } finally {
    await inst.quit().catch(() => {});
    server.close();
  }
}

export async function runTiming(ctx) {
  const out = ctx.out;
  mkdirSync(out, { recursive: true });
  const reps = Number(ctx.flag("reps", "6"));
  const server = await ctx.startServer();
  const port = server.address().port;
  const inst = await ctx.launch(ctx.app, { data: join(out, ".data", "timing"), fresh: true, session: ctx.familySession("timing", port), onboarded: true, startTimeout: 120000, files: { "perf-probe": "renders" } });
  const run = (body, timeout = 60000) => inst.eval(`${ctx.HELPERS}\n${body}`, { timeout });
  const results = { top: {}, control: {} };
  try {
    console.log(JSON.stringify(await run(`return wait(5000).then(() => [st().windows.c120.tabLayout, st().windows.k120.tabLayout]);`)));
    const timeAction = (id, action) =>
      run(`const P = globalThis.acPerf; const id = ${JSON.stringify(id)}; const loose = stripOrder(id).filter((t) => !st().tabs[t].pin);
        return D.devSetPointer(id, 640, 400, true).then(() => wait(300)).then(() => { P && P.reset(); const t0 = performance.now(); ${action}; return frames(2).then(() => { const ms = performance.now() - t0; const p = P ? P.read() : null; return { ms, commits: p ? p.commits : null, renders: p ? Object.values(p.renders).reduce((a, b) => a + b, 0) : null, commitMs: p ? p.commitMs : null, top: p ? Object.entries(p.renders).sort((a, b) => b[1] - a[1]).slice(0, 10) : null }; }); })
          .then((r) => wait(500).then(() => r));`);
    const actions = {
      switch: `ac.actions.switchToTab(loose[(loose.indexOf(st().windows[id].activeTabIds.default) + 37) % loose.length])`,
      open: `st().newTab(id, { url: "http://127.0.0.1:${port}/page/x/1" })`,
      close: `st().closeTab(st().windows[id].activeTabIds.default)`,
    };
    for (let i = 0; i < reps; i++)
      for (const [name, body] of Object.entries(actions)) {
        for (const [side, id] of [["top", "c120"], ["control", "k120"]]) {
          const r = await timeAction(id, body);
          (results[side][name] ??= []).push(r);
        }
      }
    const scrollSteps = [{ phase: "began", dx: -8 }, ...Array.from({ length: 30 }, () => ({ phase: "changed", dx: -20 })), { phase: "ended", dx: 0 }].map((s, i) => ({ ...s, timestampMs: i * 16 }));
    results.scroll = await run(`const w = st().windows.c120;
      return D.devSetWindowFrame("c120", [40 + Object.keys(st().windows).indexOf("c120") * 11, 60 + Object.keys(st().windows).indexOf("c120") * 7, w.frame[2], ${HEIGHT}]).then((frame) => nativeOf(frame)).then((n) => {
        const stamps = []; let on = true; const tick = (t) => { stamps.push(t); if (on) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
        return globalThis.expo.modules.ArdiaSwipe.devSimulate(640, 21, n, ${JSON.stringify(scrollSteps)}, true).then(() => wait(600)).then(() => { on = false; const gaps = stamps.slice(1).map((t, i) => t - stamps[i]); return { frames: gaps.length, over25: gaps.filter((g) => g > 25).length, over50: gaps.filter((g) => g > 50).length, max: Math.round(Math.max(...gaps)) }; });
      });`);
    const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const summary = {};
    for (const side of ["top", "control"])
      for (const [name, rs] of Object.entries(results[side]))
        summary[`${side}.${name}`] = { ms: +median(rs.map((r) => r.ms)).toFixed(1), commits: median(rs.map((r) => r.commits ?? 0)), renders: median(rs.map((r) => r.renders ?? 0)), commitMs: +median(rs.map((r) => r.commitMs ?? 0)).toFixed(1) };
    summary.scroll = results.scroll;
    summary.topRenders = { switch: results.top.switch?.at(-1)?.top, open: results.top.open?.at(-1)?.top, close: results.top.close?.at(-1)?.top };
    writeFileSync(join(out, "timing.json"), JSON.stringify({ summary, results }, null, 1));
    console.log(JSON.stringify(summary, null, 1));
  } finally {
    await inst.quit().catch(() => {});
    server.close();
  }
}
