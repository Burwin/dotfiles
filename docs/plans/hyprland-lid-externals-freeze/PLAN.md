# Hyprland — externals freeze on lid close (Intel i915 multi-monitor)

Status (2026-06-10): clean repro captured (post-reboot fresh session);
upstream comment posted on
[aquamarine#308](https://github.com/hyprwm/aquamarine/issues/308#issuecomment-4671488815);
`AQ_NO_ATOMIC=1` env edit applied and stowed as new `uwsm/` package
in this repo (uncommitted, pending verification).

**Resume here:** logout / log back in → verify env + log → repro lid
close → commit `uwsm/` + post follow-up comment on aq#308 based on
outcome. Full checklist is in "Candidate next steps — A" below
(steps 1–2 done, resume at step 3).

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

### H1 — Aquamarine 0.11.0 atomic-DRM page-flip race on Intel i915 (strongest)

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

1. **`AQ_NO_ATOMIC=1`** — switch aquamarine to legacy DRM iface,
   bypass atomic commits entirely. Trade-off: no HDR, no advanced
   VRR. Acceptable for our stack (1080p externals, no HDR display).
   Must be set via:
   - `~/.config/uwsm/env` (export, sourced by uwsm before Hyprland
     starts), **or**
   - a real source line for `~/.config/hypr/envs.conf` added to
     `hyprland.conf` (with `env = AQ_NO_ATOMIC,1` in that file).

   The uwsm path is the more reliable one — env vars in
   `hyprland.conf`'s `env =` directive are passed to spawned children
   but it's unclear whether aquamarine itself reads them at that
   point in the boot cycle. The uwsm export sets the var on the
   compositor process directly.

2. **Build aquamarine-git from AUR** — pulls latest fixes including
   the page-flip race patches. Trade-off: deviates from omarchy's
   pinned set; needs maintenance.

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

## Candidate next steps (pick one)

**A — Test H1 properly via uwsm env (recommended, smallest blast radius)**

Status: **in progress** as of 2026-06-10. Steps 1–2 done, resume at step 3.

1. ✓ Add `export AQ_NO_ATOMIC=1` to `~/.config/uwsm/env` with a
   comment block referencing this plan and aq#308.
2. ✓ Stow in dotfiles as new `uwsm/` package
   (`stow -d ~/src/dotfiles -t ~ uwsm`). Uncommitted on purpose
   until the test confirms direction.
3. Restart the Wayland session: `omarchy system logout`, log back
   in. uwsm only reads `env` on session start, so `hyprctl reload`
   is not sufficient.
4. Verify the env propagated:
   ```bash
   printenv AQ_NO_ATOMIC   # should print: 1
   ```
5. Verify aquamarine's atomic path is gone from the log:
   ```bash
   rg "Cannot commit when a page-flip is awaiting" \
     /run/user/1000/hypr/*/hyprland.log
   ```
   On a clean AQ_NO_ATOMIC session this should return nothing
   (or far fewer than the 3 we saw at startup in the prior test).
6. Repro: close the lid. Observe whether externals (DP-6, DP-7)
   stay live or wedge. If they wedge, run a fresh capture via
   `capture-lid-event.sh` for a side-by-side comparison.
7. Commit the `uwsm/` package, message reflecting the outcome:
   - Pass: `feat(uwsm): set AQ_NO_ATOMIC=1 to fix lid externals freeze`
   - Fail: `chore(uwsm): try AQ_NO_ATOMIC=1; did not prevent wedge`

   (Either way the env edit stays — on fail we keep it set so the
   upstream conversation has the cleaner page-flip-free baseline,
   unless the trade-off — no HDR, no advanced VRR — bites us.)
8. Post a follow-up comment on
   [aq#308](https://github.com/hyprwm/aquamarine/issues/308):
   - Pass: "AQ_NO_ATOMIC=1 prevents the wedge in this configuration."
     Brief, link the commit.
   - Fail: "AQ_NO_ATOMIC=1 does not prevent the wedge in this
     multi-monitor i915 config. Fresh capture attached." Include
     log slice + page-flip counts from the new capture.

   Use `gh issue comment 308 --repo hyprwm/aquamarine --body-file <path>`.

**B — Test H1 via Hyprland `env` directive**

1. Source `~/.config/hypr/envs.conf` from `hyprland.conf` (add the
   line; the file already exists in the dotfiles working tree as
   reverted).
2. Restore `envs.conf` with `env = AQ_NO_ATOMIC,1`.
3. Restart Hyprland (or full session — safer).
4. Same verification as A.

This is closer to the original (failed) attempt, just with the
sourcing fixed. Slightly more fragile because it depends on
aquamarine reading the var at the right point.

**C — Try H2 (DPMS-only) before rebooting**

1. Replace the lid handlers in `bindings.conf`:
   ```
   bindl = , switch:on:Lid Switch, exec, hyprctl dispatch dpms off eDP-1
   bindl = , switch:off:Lid Switch, exec, hyprctl dispatch dpms on eDP-1
   ```
2. Test the close → open cycle.
3. Inspect `hyprland.log` for whether DP-6/DP-7 still get
   re-modeset. If not, this is a clean win without touching
   aquamarine.

**D — Verbose-log capture for upstream**

Run with `HYPRLAND_LOG_WLR=1` and `AQ_TRACE=1` (if supported) and
capture the exact sequence around the lid close. Useful before
filing/commenting on
[hyprwm/aquamarine#304](https://github.com/hyprwm/aquamarine/issues/304)
to give upstream a clean repro.

## Capture protocol (active path)

Per user direction (2026-06-10), next step is **D — Verbose log
capture for upstream**. Procedure:

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

- A: remove the export line from `uwsm/.config/uwsm/env` in this
  repo (or `stow -D -d ~/src/dotfiles -t ~ uwsm` + `rm -rf uwsm/` to
  fully unstow the package); log out / in.
- B: remove the `source` line from `hyprland.conf` and delete
  `envs.conf`, `hyprctl reload`.
- C: `git restore hypr/.config/hypr/bindings.conf`, `hyprctl reload`.

Baseline = commit `98abc12f` (focus-external-first hack), which is
the current HEAD state. The plan is decision history; revert ≠ archive
until a candidate ships.

## Open questions for user

1. Pick a candidate (A / B / C / D) for the next investigation pass.
2. OK to do a full session logout+login during testing, or do we need
   to keep the session live (which constrains us to `hyprctl`-only
   changes)?
3. Should we also attempt to scope-creep the `SUPER+CTRL+Delete` /
   Hardware menu lid-toggle paths (which still call
   `omarchy-hyprland-monitor-internal toggle` and could re-introduce
   the original crash race), or keep that strictly out of scope?
