# Phone runs: fixed-clock input and measurement

The testers' tooling for measuring the Android app on a real phone the same way every run (sync11 and sync12 on
the POCO M3 Pro), kept here so a run does not rebuild it. Evidence from each run stays under
`/tmp/ardia-phone-shots/<build>-<phone>/`; nothing here writes there by itself.

## The touch jar (not yet in the repo)

`ardia-touch.jar` (class `agentd.ArdiaTouch`, run with `app_process`) replays a schedule of taps and swipes at fixed
offsets, built from agent-os's own Hid/Input classes, so every mode gets identical input regardless of how fast the
app settles. It lives on the phones in `/data/local/tmp/ardia-sync12/` and its source was not saved. The next tester
who builds it should add its source and a build script to this folder. sync13's M3 tester rebuilt it from agent-os's uhid `Hid.java` (a report every 8 ms, taps held 50 ms); the sync14 tester saves the jar and its source under `touch-jar/` in its output, from which it moves here.

## Schedules

`sched-*.txt`: one action per line, `offset_ms action args`, where action is `tap x y` or `swipe x1 y1 x2 y2 ms`.
Coordinates are for a 1080 × 2400 phone. `sched-expo13.txt` is the 37 s step-38 script for sync13 and later, whose bar puts New Tab at y 2184 (sync13 on the M3); `sched-expo.txt` is the same script for sync11 and sync12 (New Tab at y 1945);
`sched-ds-*.txt` are the "Deck speed" windows (open, pre-position, scroll, tray); `sched-tray*.txt` open and close the
tray over a page.

## Scripts

Each starts with the serial (`S=`), the output folder on the Mac (`O=`) and the folder on the phone
(`/data/local/tmp/ardia-sync12`) of the run it was written for; set them for the run.

- `timed.sh <schedule> <window_s> <measure 1|0>` (on the phone): starts the jar, resets `gfxinfo` once the jar is
  ready, waits the window, dumps `gfxinfo`.
- `measure.sh run|warm|idle <name> [schedule]`: checks the animator scale is 1, then the 37 s run, an unmeasured
  warm-up, or a 30 s idle window.
- `ds.sh <name> <schedule> <window_s>`: one "Deck speed" window with the animator-scale check.
- `idle.sh <seconds>` (on the phone): `gfxinfo` over an untouched window.
- `mem.sh <label>`: the lab's Memory broadcast, appending the new `PAGELAB memory` lines and `dumpsys meminfo` to
  `memory.txt`.
- `coldstart.sh <n>`: force-stop, launch, screenshot after 3 s, report whether the tray is open.
- `open9.sh`: opens the nine pages every run uses, in order, one VIEW intent each.
- `perf-window.sh <gfx file>`: the `PAGELAB perf` lines inside that window (the phone's clock is UTC+5:30).
- `scalewatch.sh`: logs every change of the animator duration scale (MIUI's Developer options resets it).
- `sum.sh <gfx files…>`: one line per `gfxinfo` dump: frames, janky share, the 50th, 90th, 95th and 99th percentiles, the GPU median, slow UI and slow draw commands.
- `blankscan.py`: finds flat (blank) frames in a screen recording's page area above the tray.
