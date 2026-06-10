# Hyprland — externals freeze on lid close (Intel i915 multi-monitor)

Status (2026-06-10, **PAUSED**): candidate C
(commit `cef7a7a`, mirror+dpms) **disconfirmed on atomic DRM** —
the production-state lid cycle still wedges DP-6/DP-7. Work paused
per user direction; relying on the next omarchy/aquamarine bump
(targeting `f5cdaa8` "CRTC starvation recovery + clear stale
page-flip state after suspend" or later) to fix this from upstream.
Detail: `atomic-drm-wedge-evidence.md`.

`cef7a7a` is **kept in place**, not reverted. On legacy DRM it is
still a strict UX win (wedge avoidance + cursor clamping). On
atomic DRM it is no worse than the prior baseline (focus-first hack
also wedged), and reverting would lose the legacy-DRM benefit
without fixing atomic. The mirror cascade-free claim only holds
for legacy DRM — see disconfirmation entry in the timeline.

Candidate A (`AQ_NO_ATOMIC=1`) was tested and disconfirmed earlier
in the same session — wedge reproduced identically on legacy DRM,
plus gamma support is lost on legacy iface. `uwsm/` package
reverted (never committed). Follow-up posted on aq#308:
[issuecomment-4671818195](https://github.com/hyprwm/aquamarine/issues/308#issuecomment-4671818195)
(local copy at `UPSTREAM-COMMENT-FOLLOWUP.md`).

**Resume signals (when picking this up again):**

1. **Omarchy bumps `aquamarine` past 0.11.0-2** — first thing to
   try. `pacman -Qi aquamarine` post-bump; if `f5cdaa8` is in,
   re-test the lid cycle in a fresh session. If clean, mark this
   plan archived.
2. **If omarchy hasn't bumped and the wedge becomes painful** —
   move to candidate E (build `aquamarine-git` from AUR).
3. **If wanting to chase further within the current pin** — the
   "mystery cluster" of 5 page-flip errors at lines 423–427 of
   `atomic-drm-lid-events.log` (post-libinput-register, pre-
   user-lid-event) is unexplained and could be compounding the
   wedge. Investigate before attempting another mitigation.

A follow-up upstream comment on aq#308 with the atomic-DRM repro
data is **not** filed; if work resumes and we still need upstream
attention, draft from `atomic-drm-wedge-evidence.md`.

## Problem

On Dell Precision 7760 (Intel Tiger Lake-H iGPU + NVIDIA T1200 dGPU
present but dormant; all 3 active monitors on the **Intel iGPU**),
closing the lid disables eDP-1 but intermittently leaves DP-6/DP-7
in a half-dead state:

- Backlight stays on, but the framebuffer stops updating.
- The HW cursor still moves (cursor plane is independent of the
  page-flip pipeline, which is why it remains responsive).
- Reopening/closing the lid does **not** recover the externals.
- Eventually a combination of "open lid + move mouse" unsticks the
  page-flip and the screens come back.

This is a **different bug** from the May 2026 Hyprland-crashes-on-
lid-close issue (archived at `docs/archive/hyprland-lid-crash-plan.md`
and `docs/archive/2026-05-07-hyprland-lid-switch.md`). That one was
fixed by replacing `hyprctl reload` with the atomic
`hyprctl keyword monitor` form. Hyprland no longer crashes; it just
strands the externals' page-flip on the modeset that the eDP-1
disable forces.

## Hardware / software (as of 2026-06-10)

| Item | Value |
| --- | --- |
| Laptop | Dell Precision 7760 |
| iGPU | Intel Tiger Lake-H UHD Graphics (`8086:9a70`) |
| dGPU | NVIDIA T1200 Laptop (`10de:1fbc`) |
| NVIDIA driver | `nvidia-open-dkms 595.71.05-2` |
| Hyprland | `0.55.2-1` (omarchy-pinned) |
| Aquamarine | `0.11.0-2` |
| Hyprutils | `0.13.1-1` |
| Mesa (iGPU render path) | `26.1.1-arch1.2` |
| Omarchy | post-lid-toggle migration era |

**DRM card mapping (this boot):**

| Card | Driver | Active connectors | Role |
| --- | --- | --- | --- |
| `card1` | `nvidia` | (none lit) | dormant; physical DP/HDMI ports unused |
| `card2` | `i915` | eDP-1, DP-6, DP-7 | drives **all** active displays |

All three monitors are on **Intel i915**, not NVIDIA. The NVIDIA dGPU
is present but not driving any active output in this session.
Hyprland confirms: `CDRMRenderer(drm): Using device /dev/dri/card2`,
`Vendor: Intel`, `Renderer: Mesa Intel(R) UHD Graphics (TGL GT1)`.

This means the page-flip race we're hitting is on **Intel i915**,
not on the NVIDIA driver — which makes upstream
[aq#308](https://github.com/hyprwm/aquamarine/issues/308) ("Lid-resume
eDP panel wedge persists on Intel i915") much more directly relevant
than first thought. PCIe enumeration order has flipped between past
boots — the May 2026 archived plan recorded "all on card2 (NVIDIA)"
because card2 happened to be NVIDIA at the time of that capture. Card
numbering is not stable; verify per-boot.

The page-flip race is pre-existing regardless of lid handling — see
"Evidence" below.

## Timeline

| Date | Symptom | Fix attempt | Outcome |
| --- | --- | --- | --- |
| 2026-05-06 | Hyprland SIGSEGV on lid close, multi-monitor | Override omarchy lid handler with atomic `hyprctl keyword monitor "eDP-1, disable"` (kills the `hyprctl reload` race) | Crash fixed. Plan archived. |
| 2026-05-07 | Boot-with-lid-closed didn't disable eDP-1 (bindl only fires on transitions) | `exec-once` in `autostart.conf` reads `/proc/acpi/button/lid/LID*/state` at startup | Fixed. Plan archived. |
| 2026-06-09 (commit `98abc12f`) | First lid-close after boot leaves externals' framebuffer frozen, cursor still moves | Focus first non-eDP-1 monitor before disabling eDP-1, so focus migrates cleanly | Initially appeared to fix but **did not** — see today's test. |
| 2026-06-10 (uncommitted, now reverted) | Same symptom persists | Theorize aquamarine 0.11.0 stranded `isPageFlipPending` race; add `env = AQ_NO_ATOMIC,1` to a new `~/.config/hypr/envs.conf`; revert focus-first hack | **Did not test what we thought it did.** `envs.conf` was never sourced — see "Critical gotcha" below. The actual test ran without AQ_NO_ATOMIC and without the focus-first hack, i.e. plain `hyprctl keyword monitor`. Symptoms got slightly worse (initial lid-close did nothing; required mouse movement; transient keystroke repetition). |
| 2026-06-10 (post-reboot) | Captured clean repro for upstream | Ran `capture-lid-event.sh` flow (split inline through opencode, fresh session post-restart) | Clean repro: 1 stranded page-flip on DP-6's modeset right after eDP-1 disable, exactly matching the visual wedge. 3 startup errors + 14 in 113s test window (1 wedge, 13 background race). Comment drafted at `UPSTREAM-COMMENT.md`, capture saved at `~/lid-capture-20260610-102949/` (+ tarball). |
| 2026-06-10 (post-restart) | First lid-close after restart with `AQ_NO_ATOMIC=1` confirmed active | Stowed `uwsm/` package exporting `AQ_NO_ATOMIC=1`, restarted machine, verified env + legacy drm iface in log | **Wedge reproduced identically.** DP-6/DP-7 went black with cursor still moving; recovered on lid open. 12 page-flip errors at startup + 5 in test window — same family of "Cannot commit when a page-flip is awaiting" errors fire on the legacy path. Disconfirms H1's atomic-only framing. Reverted `uwsm/` package (never committed). |
| 2026-06-10 (commit `cef7a7a`) | Candidate C: replace `keyword monitor "eDP-1, disable"` with `dpms off` + mirror against an external | First tried plain DPMS-off (passed wedge but cursor could still wander to lidded eDP-1 at x=3840). Probed `keyword monitor "eDP-1, ..., mirror, DP-6"` — 0 log lines, 0 cascade. Combined: focus external → DPMS off → mirror eDP-1 against the focused external. | **Both pass criteria met on legacy DRM.** Lid-close: externals stay live, no DP-6/DP-7 modeset cascade, cursor clamped to 0..3839. Lid-open cascade is real (3 page-flip errors, modesets across all 3 connectors) but does not wedge. Atomic-DRM confirmation pending next session. |
| 2026-06-10 (post-restart, atomic DRM) | Candidate C atomic-DRM verification | Fresh session, `AQ_NO_ATOMIC` unset (verified via `cat /proc/<pid>/environ`), aquamarine logged `Atomic supported, using atomic for modesetting`. Single user-driven lid close+open cycle. | **Disconfirmed on atomic.** User-confirmed standard repro: externals wedged on lid close (black with cursor still moving), recovered with mouse-jiggle on lid open. 13 page-flip errors at startup, 5 in a "mystery cluster" before the lid event, 2 during the lid-close cascade, 0 on lid-open. The mirror command **did** cascade onto DP-6 + DP-7 on atomic (lines 443/445 of `atomic-drm-lid-events.log`), contrary to the legacy probe. Cascade-free claim holds for legacy iface only. Evidence preserved at `atomic-drm-wedge-evidence.md` + `atomic-drm-lid-events.log` + `atomic-drm-monitors-after.json`. Plan paused; cef7a7a kept (legacy gain, atomic break-even with revert baseline). |

## Today's test (2026-06-10)

User-reported sequence:

1. Shutdown PC (lid open).
2. Open lid, power on PC.
3. Login via hyprlock as usual.
4. Close lid → **nothing happened immediately**.
5. Move mouse → externals went black, but cursor still visible.
6. Open lid → no change (still black).
7. Close lid → no change.
8. Open lid + move mouse → screens came back.
9. Close lid → recovers normally on subsequent close.
10. Opened terminal: **keystrokes repeating** (e.g. "nothinnnng", "typinnnng").

The keystroke repetition is new and may or may not be related; could
be input-pipeline desync from the same compositor stall. Track but
don't chase yet.

## Critical gotcha discovered 2026-06-10

The `~/.config/hypr/envs.conf` file we wrote to set `AQ_NO_ATOMIC=1`
**was never sourced by Hyprland**. The main `hyprland.conf:9` only
sources the omarchy default:

```
source = ~/.local/share/omarchy/default/hypr/envs.conf
```

There is no `source = ~/.config/hypr/envs.conf` line. The file was
stowed into `~/.config/hypr/envs.conf` as a symlink, but Hyprland
never reads it. The user's `~/.config/uwsm/env` also does not export
`AQ_NO_ATOMIC`. Verified at session level: `printenv AQ_NO_ATOMIC`
returns empty in the running session.

**Implication:** the AQ_NO_ATOMIC hypothesis is untested. The user
effectively tested only the *removal* of the focus-first hack, on
the same buggy aquamarine-atomic path as before.

## Evidence (this current session, post-revert)

`/run/user/1000/hypr/<HIS>/hyprland.log` already contains 16
`drm: Cannot commit when a page-flip is awaiting` errors logged
during the initial multi-monitor modeset at startup, **before any
lid event**:

```
drm: Modesetting eDP-1 with 1920x1080@60.00Hz
drm: Modesetting eDP-1 with 1920x1080@60.00Hz
ERR drm: Cannot commit when a page-flip is awaiting   (line 363)
... (12 more during card2 bring-up + DP-6/DP-7 modesets)
libinput: New device Lid Switch: 0-5                   (line 416)
drm: Modesetting eDP-1 with 1920x1080@60.00Hz
drm: Modesetting DP-6 with 1920x1080@60.00Hz
ERR drm: Cannot commit when a page-flip is awaiting   (line 423)
... (4 more)
```

The race is therefore **not lid-specific**: any modeset on this
hybrid setup risks stranding a page-flip. Lid close is just the most
common trigger path because it forces a modeset of all three
connectors.

No Hyprland crash reports today (last entries in
`~/.cache/hyprland/hyprlandCrashReport*.txt` are from 2026-05-06).
This is a stall, not a crash.

## Current baseline (after revert)

Working tree is clean. Live state:

- `hypr/.config/hypr/bindings.conf` — focus-first hack from
  commit `98abc12f` (focus first non-eDP-1 monitor before disabling
  eDP-1, then disable eDP-1 via `hyprctl keyword monitor`).
- `hypr/.config/hypr/autostart.conf` — boot-with-lid-closed
  workaround from 2026-05-07.
- No `envs.conf` in the dotfiles repo or live config.

`hyprctl reload && hyprctl configerrors` returns `ok` / no errors.
This is the iteration that the user said "still had issues" on
yesterday's test, but is the most-recent committed state and a
known reference point.

## Hypothesis space

Ranked by current confidence, highest first.

### H1 — Aquamarine 0.11.0 page-flip race on Intel i915 (still the leading hypothesis, atomic and legacy code paths affected differently)

**Update 2026-06-10 (post-restart test):** the "atomic-only" framing
was wrong. With `AQ_NO_ATOMIC=1` confirmed active (aquamarine logged
`legacy drm iface` for both cards), the same wedge reproduced and
the same "Cannot commit when a page-flip is awaiting" errors fired
on the legacy path (12 at startup, 5 during test). The wedge is in
a code path shared by atomic and legacy drm — likely connector
enable/disable sequencing inside aquamarine, or a kernel-side i915
issue triggered by clustered modesets. Treat the page-flip race as
real but **not** an atomic-iface bug. AQ_NO_ATOMIC mitigation
candidate (1 below) is now **disconfirmed** for this configuration.

**Update 2026-06-10 (atomic-DRM candidate C verification):** the
mirror+dpms approach (cef7a7a) avoids the cascade on legacy iface
but **not** on atomic. On atomic, applying `keyword monitor "eDP-1,
..., mirror, DP-6"` triggers Hyprland's atomic-commit path to
re-modeset all connectors, firing 2 page-flip errors and wedging
DP-6/DP-7 just like the original `disable` form. Refines the
hypothesis: the page-flip race is a shared problem on i915, but
its cascade triggers differ between atomic and legacy. On legacy,
the mirror command is a no-op-ish remap that doesn't cascade; on
atomic, every monitor-config write goes through the same atomic
state-machine and any change cascades. Mitigation requires
either: (a) avoiding the cascade entirely (no realistic path
within Hyprland userspace today), (b) the upstream aquamarine fix
that recovers from stranded page-flips (`f5cdaa8` and successors,
unreleased as of 2026-06-10).

The 16 page-flip errors already in this session's log are
diagnostic of the same wedge family upstream is tracking:

- [aq#304](https://github.com/hyprwm/aquamarine/issues/304) — OPEN.
  AMD, idle-DPMS-driven eDP wedge, single eDP. Different trigger,
  same wedge symptom (backlight on, no scanout).
- [aq#307](https://github.com/hyprwm/aquamarine/issues/307) — CLOSED.
  Intel i915 lid-suspend, single eDP. Title: "AQ_NO_ATOMIC mitigates
  fast-spin path but not lid-resume wedge". So `AQ_NO_ATOMIC` helped
  but only partially.
- [aq#308](https://github.com/hyprwm/aquamarine/issues/308) — OPEN.
  Intel i915 lid-suspend with f5cdaa8 ("CRTC starvation recovery +
  clear stale page-flip state after suspend") in place; wedge still
  reproduces. Single eDP, no externals.
- [Hyprland#14521](https://github.com/hyprwm/Hyprland/issues/14521).

Our variant differs: lid close (no suspend) + multi-monitor on
Intel i915, externals wedge while eDP-1 disables cleanly. New data
point worth filing once we have a clean log. The fix targeted by
f5cdaa8 lives in aquamarine main and is unreleased; current arch
package is still 0.11.0 without it.

**Mitigation candidates:**

1. ~~**`AQ_NO_ATOMIC=1`**~~ — **disconfirmed 2026-06-10.** Switching
   aquamarine to legacy DRM iface had no effect on the wedge in our
   multi-monitor i915 config. The legacy path also fires the
   page-flip-awaiting errors, and the wedge symptom is identical.
   Additional cost on legacy iface: `No support for gamma` (night
   light breaks). Net: no benefit, real cost. Reverted.

2. **Build aquamarine-git from AUR** — pulls latest fixes including
   the page-flip race patches (notably f5cdaa8). Trade-off: deviates
   from omarchy's pinned set; needs maintenance. Worth re-evaluating
   now that AQ_NO_ATOMIC is out of the running.

3. **Defer until next omarchy bump** — wait for upstream to ship the
   aquamarine fix and let omarchy pull it in.

### H2 — DPMS off / monitor disable interaction

Instead of fully disabling eDP-1 (which forces a re-modeset of all
connectors), we could use `dpms off` for eDP-1 only, which leaves
the connector active but turns the panel off. The hypothesis is
that `dpms off` does not trigger a re-modeset of DP-6/DP-7 the way
`monitor=eDP-1,disable` does, so the page-flip race never fires.

Trade-offs:
- `dpms off` doesn't reclaim eDP-1's workspace space (windows
  remain on a "ghost" monitor).
- May not actually skip the re-modeset; needs verification.

### H3 — Hyprland startup race adds risk to the *first* lid close

The first 12 page-flip errors fire during initial bring-up, well
before the user can do anything. Maybe by the time the lid event
arrives, aquamarine is in a "stranded but not yet recovered"
state, so the lid-induced modeset compounds it. If we can clear
the page-flip queue before the first lid event (e.g. force one
extra `hyprctl reload` 5s after startup, or wait until aquamarine
logs `onReady` for all connectors), maybe the lid handler runs
on a clean state.

This is more speculative; reserve as Plan C.

### H4 — NVIDIA driver / kernel pairing (deprioritized)

Originally suspected `nvidia-open-dkms 595.71.05-2`, but with the
corrected diagnosis (all monitors on Intel iGPU, NVIDIA dormant),
this is much less likely. Keep as fallback only if Intel-side
hypotheses are exhausted.

## Candidate next steps

**C — DPMS + mirror (SHIPPED, atomic verification FAILED; kept anyway)**

Shipped in commit `cef7a7a`. Final design:

- **Lid close:** focus first non-eDP-1 external, then `dpms off
  eDP-1`, then `keyword monitor "eDP-1, preferred, 0x0, 1, mirror,
  $ext"`. The mirror reassigns eDP-1's coord space to overlap the
  external, so cursor and workspaces stay inside 0..3839; DPMS
  keeps the panel dark.
- **Lid open:** `keyword monitor "eDP-1, preferred, auto, auto"`
  (revert mirror; this triggers a real modeset cascade) then
  `dpms on eDP-1`. The cascade on lid-open never produced a wedge
  in any of our tests — the wedge specifically requires a
  cascade-while-page-flip-pending at lid-close moment.

**Atomic-DRM verification (2026-06-10): FAILED.** Wedge reproduced
on first lid close in a fresh atomic-DRM session. The mirror
command, which probed cascade-free on legacy DRM, does cascade on
atomic. See `atomic-drm-wedge-evidence.md` for the full evidence
and revised mechanism.

**Decision (2026-06-10): keep cef7a7a, do not revert.**

- On legacy DRM: cef7a7a is a strict win (no wedge, cursor clamped).
- On atomic DRM: cef7a7a is no worse than the prior baseline (the
  focus-first hack from `98abc12f` also wedged). Reverting would
  give up the legacy benefit without fixing atomic.
- Removing cef7a7a only makes sense if we're moving to a fix that
  works on atomic (E below) and the mirror handler interferes —
  no evidence of interference today.

**E — Build aquamarine-git from AUR (PARKED, available if needed)**

Not currently pursued. Trade-off rejected for now: deviates from
omarchy's pinned set, needs ongoing maintenance, and may break on
omarchy updates that pin aquamarine. Cheaper to wait for the next
omarchy bump.

If picking up later:

1. `paru -S aquamarine-git` (or equivalent) and pin against the
   `f5cdaa8` commit or later.
2. Restart full session.
3. Re-run the capture-lid-event.sh flow on atomic DRM.
4. Document the deviation from omarchy's pin in the commit.

**Reference (deprioritized) — done or rejected paths:**

- ~~**A — `AQ_NO_ATOMIC=1` via `~/.config/uwsm/env`**~~. Tested
  2026-06-10, disconfirmed (see timeline). Wedge reproduced
  identically on legacy DRM iface; gamma cost is real. Reverted.
- ~~**B — `AQ_NO_ATOMIC=1` via Hyprland `env` directive**~~. Same
  hypothesis as A, just a different mechanism. Disconfirmed by A's
  result.
- **D — Verbose-log capture for upstream.** Already done as part
  of the 2026-06-10 capture flow; `~/lid-capture-20260610-102949/`
  is the artifact. Re-run with `AQ_TRACE=1` if upstream asks.

## Capture protocol (reference)

Already executed once (artifact at `~/lid-capture-20260610-102949/`).
Re-run for any candidate that produces a different outcome from the
baseline so we have a side-by-side artifact for upstream. Procedure:

### Step 1 — Reproduce in a fresh session

The bug fires on the first lid-close after a fresh Hyprland start.
A logout + login is required between captures to reset the
page-flip state.

### Step 2 — Run the capture script

`docs/plans/hyprland-lid-externals-freeze/capture-lid-event.sh`
captures:

- `system-inventory.md` — package versions, kernel, DRM card map,
  active env vars, lid state.
- `monitors-before.json` / `monitors-after.json` — monitor state
  pre / post test.
- `hyprland-full.log` — full Hyprland runtime log copy.
- `hyprland-test-window.log` — log lines added during the test
  window only.
- `hyprland-lid-events.log` — filtered to lid / drm / page-flip /
  modeset / dpms / focusmonitor lines.
- `dmesg-drm.log` / `dmesg-full.log` — kernel side, since test
  start.
- `log-markers.txt` — byte/line counts and timestamps to bound the
  test window.
- `REPORT.md` — markdown summary with monitor-state diff and
  page-flip error counts (pre vs during).

Output goes to `~/lid-capture-<timestamp>/`.

### Step 3 — Reproduction sequence

In a fresh Hyprland session, in a tmux pane that survives the lid
event:

```bash
~/src/dotfiles/docs/plans/hyprland-lid-externals-freeze/capture-lid-event.sh
```

When prompted:

1. Close lid → wait for the externals stall (black with cursor).
2. Open lid + move mouse until screens recover.
3. (Optional) close lid again to confirm post-recovery normal
   behavior; open lid to exit.
4. Press ENTER in the script terminal to finalize.

### Step 4 — Review and decide on upstream filing

Review `REPORT.md`. Confirm:

- `Page-flip errors during test window` count is non-zero.
- `monitors-after.json` shows DP-6/DP-7 still listed but with the
  expected dpms / disabled state matching the wedge.
- `hyprland-lid-events.log` shows the `bindl` exec, the modeset
  sequence, and the page-flip errors interleaved.

If all three are present, we have a reportable repro. Use the
template below to draft an upstream comment / issue.

### Step 5 — Optional: enable AQ_TRACE for a second capture

If upstream maintainers ask for trace-level detail (or before
filing if we want to be thorough), add to `~/.config/uwsm/env`:

```
export AQ_TRACE=1
```

Then logout / login and re-run the capture. Trade-off: AQ_TRACE
output is high-volume; tmpfs `hyprland.log` may need rotation.

## Upstream report template

Draft for filing as a new aquamarine issue or commenting on
[aq#308](https://github.com/hyprwm/aquamarine/issues/308). Fill
the `<...>` placeholders from the capture report.

```markdown
## Summary

On lid close, disabling eDP-1 forces a re-modeset of all three
i915-driven monitors (eDP-1 + 2 externals). The externals' page-
flip ends up stranded — backlight on, no scanout, only the HW
cursor plane keeps updating. Recovery requires opening the lid
*and* moving the mouse; lid alone does not recover. After one
recovery, subsequent close/open cycles work normally for the
session lifetime. New session = bug returns on first close.

Wedge symptom matches #308 (Intel i915 + lid + eDP wedge). Differs
in: (a) trigger is plain lid-close, no suspend; (b) wedge is on
external monitors, not on the eDP; (c) multi-monitor (eDP-1 +
DP-6 + DP-7).

## System

- **GPU**: Intel Tiger Lake-H UHD Graphics [8086:9a70], i915 driver
  (`card2` this boot). Mesa 26.1.1.
- **Other GPU**: NVIDIA T1200 Laptop [10de:1fbc] present (`card1`
  this boot, dormant — not driving any active connector).
- **Monitors**: eDP-1 (BOE 1920x1080@60), DP-6 (Dell P2223HC
  1920x1080@60), DP-7 (same). All three on i915.
- **Hyprland**: 0.55.2-1 (Arch / Omarchy pin).
- **Aquamarine**: 0.11.0-2 (Arch package, no f5cdaa8).
- **Hyprutils**: 0.13.1-1.
- **Kernel**: <fill from inventory>
- **Session manager**: UWSM, atomic DRM (no `AQ_NO_ATOMIC`).
- **Lid handler**: custom override using
  `hyprctl keyword monitor "eDP-1, disable"` (atomic IPC keyword,
  not the omarchy default `hyprctl reload` path).

## Reproduction

1. Cold boot, lid open, login normally.
2. After Hyprland is fully up (3 monitors active), close the lid.
3. Externals (DP-6/DP-7) go to backlight-on / no-scanout
   immediately or after ~1s. Cursor still moves. eDP-1 disables
   cleanly.
4. Opening the lid alone does not recover.
5. Opening the lid + moving the mouse recovers DP-6/DP-7
   scanout.
6. Subsequent close/open cycles in the same session work
   normally.

## Aquamarine log around the lid event

<paste hyprland-lid-events.log slice here>

## Page-flip error count

- During Hyprland session startup (before any lid event):
  <PRE_FLIP_ERRORS>
- During the test window (lid close + recovery):
  <TEST_FLIP_ERRORS>

## Monitor state

Before:

```json
<paste monitors-before.json filtered>
```

After (post-recovery):

```json
<paste monitors-after.json filtered>
```

## Workaround tried

- `hyprctl keyword monitor "eDP-1, disable"` (atomic IPC keyword
  rather than `hyprctl reload`) — fixed the previous crash family
  (filed as basecamp/omarchy#5457) but does **not** prevent the
  wedge described here.
- "Focus first non-eDP-1 monitor before disabling eDP-1" — no
  measurable effect.
- `AQ_NO_ATOMIC=1` not yet tested in this configuration; will
  follow up with results.

## Cross-reference

- #304 — same wedge symptom (backlight on, no scanout, only-restart
  recovers), AMD, idle-DPMS trigger.
- #307 — closed; AQ_NO_ATOMIC partial mitigation on Intel i915.
- #308 — open; Intel i915 lid wedge with f5cdaa8 in place.
- Hyprland #14521 — earlier atomic-commit family.
```

## Out of scope (for now)

- Keystroke repetition symptom — track if it recurs but don't chase
  until the page-flip stall is resolved.
- Filing a new upstream issue (we should comment on existing aq#304
  with our 0.55.2/0.11.0/595.71.05 stack data once we have a clean
  log).
- Migrating from `nvidia-open-dkms` to closed-source `nvidia-dkms`.
- Replacing the externals (Dell P2223HC) — known-good 1080p
  monitors, not the suspect.

## Verification criteria (whichever path we pick)

After applying a candidate fix:

1. `hyprctl monitors -j | jq '[.[] | .name]'` returns
   `["eDP-1","DP-6","DP-7"]` from a fresh session.
2. Cold-boot test: shutdown with lid open, boot with lid open,
   login, close lid → externals stay live, framebuffer keeps
   updating (move a mouse-tracking app and confirm pixels change).
3. `tail -200 /run/user/1000/hypr/*/hyprland.log | rg "Cannot commit"`
   returns nothing for the post-lid-close section.
4. Open lid → eDP-1 returns; all 3 monitors active.
5. Repeat close/open 3× without recovery hacks (no stall, no
   black-with-cursor state).

## Rollback

Each candidate is a single-file change. To revert:

- C (mirror+dpms): `git revert cef7a7a` returns to the
  focus-first hack of `98abc12f`. Kept in place per the
  decision in C above; rolling back is only meaningful if
  another candidate replaces it.
- E (aquamarine-git, not currently applied): `paru -R aquamarine-git
  && paru -S aquamarine` (or whatever omarchy's pin resolves to),
  restart session.

Current HEAD ships cef7a7a as the live state. The plan is decision
history; this file stays in `docs/plans/` until either an upstream
fix lands or work resumes on E.

## Open questions for user

1. If C passes but the workspace-ghost trade-off bites (windows
   stuck on a lidded eDP-1), should we try to teach the lid handler
   to migrate workspaces off eDP-1 first, then DPMS off? That puts
   us back in `keyword monitor` territory which is the bug we're
   avoiding.
2. Should we also attempt to scope-creep the `SUPER+CTRL+Delete` /
   Hardware menu lid-toggle paths (which still call
   `omarchy-hyprland-monitor-internal toggle` and could re-introduce
   the original crash race), or keep that strictly out of scope?
