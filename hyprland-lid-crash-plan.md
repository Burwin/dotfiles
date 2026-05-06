# Hyprland lid-switch crash — fix plan

Status: **draft, not yet executed**.
Date: 2026-05-06.
Owner: mbh.

## Symptom

1. Booting the laptop with the lid closed crashes Hyprland during session
   bring-up. uwsm restarts it, and the cycle can repeat.
2. Opening the lid and exiting Hyprland brings the session back with all
   three monitors visible.
3. Closing the lid again crashes Hyprland the same way.

Expected behavior:

1. Boot with the lid closed → both external monitors come up; eDP-1 stays
   disabled.
2. Open the lid → eDP-1 joins as a third monitor.
3. Close the lid → eDP-1 disabled; externals keep working.

## Diagnosis

### Hardware / software

| Item | Value |
| --- | --- |
| Laptop | Dell Precision 7760 |
| iGPU | Intel Tiger Lake-H UHD Graphics (`8086:9a70`) |
| dGPU | NVIDIA T1200 Laptop (`10de:1fbc`), driver `nvidia-open-dkms` |
| Monitors | eDP-1 (BOE 1920x1080), DP-6 (Dell P2223HC), DP-7 — all on DRM `card2` (NVIDIA) |
| Hyprland | `0.54.3-4` (pinned by Omarchy) |
| Aquamarine | `0.11.0-2` |
| Hyprutils | `0.13.0-1` |
| Pixman | `0.46.4-1` |
| xdg-desktop-portal-hyprland | `1.3.12-2` |
| Kernel | `7.0.3-arch1-2` |
| Omarchy | `3.7.x` (post lid-toggle migration) |

### Root cause

Omarchy's recent lid migration introduced these defaults at
`~/.local/share/omarchy/default/hypr/bindings/utilities.conf:34-35`:

```
bindl = , switch:on:Lid Switch, exec, omarchy-hw-external-monitors && omarchy-hyprland-monitor-internal off
bindl = , switch:off:Lid Switch, exec, omarchy-hyprland-monitor-internal on
```

`omarchy-hyprland-monitor-internal off`
(`~/.local/share/omarchy/bin/omarchy-hyprland-monitor-internal:19-29`) does:

1. Writes `monitor=eDP-1,disable` to
   `~/.local/state/omarchy/toggles/hypr/internal-monitor-disable.conf`
   (which `hyprland.conf` globs in via
   `source = ~/.local/state/omarchy/toggles/hypr/*.conf`).
2. Calls `hyprctl reload`.

The full `hyprctl reload` re-evaluates every monitor. On this hybrid-GPU /
multi-monitor setup (3 monitors all on the NVIDIA card) it triggers an
aquamarine race. Crash report log tail
(`~/.cache/hyprland/hyprlandCrashReport*.txt`):

```
drm: Modesetting eDP-1 with 1920x1080@60.00Hz
drm: Modesetting DP-6 with 1920x1080@60.00Hz
drm: Modesetting DP-7 with 1920x1080@60.00Hz
drm: Disabling output eDP-1            ← lid handler ran
drm: Modesetting DP-6 with 1920x1080@60.00Hz
drm: Modesetting DP-7 with 1920x1080@60.00Hz
ERR drm: Cannot commit when a page-flip is awaiting   ← race
drm: Modesetting DP-7 with 1920x1080@60.00Hz
drm: Disabling output DP-6             ← all monitors gone
drm: Disabling output DP-7
```

Hyprland then SIGSEGVs in
`CWLSurfaceResource::commitState` →
`CExtImageCopyCaptureFrameV1::~CExtImageCopyCaptureFrameV1` (screen-capture
portal commits state with no surviving monitor). A second crash signature in
`CMonitorFrameScheduler::onFrame()` shows up after the lid event repeats.
`xdg-desktop-portal-hyprland` SIGSEGVs alongside Hyprland, and the next session
prints repeated `pixman_region32_init_rect: Invalid rectangle passed`.

### Why "boot with lid closed" reproduces it

Hyprland starts with all three monitors present. As soon as libinput creates
the `Lid Switch` device in the closed state, Hyprland fires
`bindl = , switch:on:Lid Switch`, the omarchy script runs `hyprctl reload`,
and the same race crashes the brand-new session.

### Why the previous setup worked

The pre-migration backup at
`~/.config/hypr/hyprland.conf.bak.1778071231:25-26` had:

```
bindl=,switch:on:Lid Switch,exec,hyprctl keyword monitor "eDP-1, disable"
bindl=,switch:off:Lid Switch,exec,hyprctl keyword monitor "eDP-1, preferred, auto, auto"
```

`hyprctl keyword monitor` is atomic — it changes one keyword without re-reading
the entire config — so it never tickles the page-flip race that the reload
path does.

### Evidence cross-references

- Coredumps: `coredumpctl list` shows 4 Hyprland SIGABRTs and one
  `xdg-desktop-portal-hyprland` SIGSEGV today (2026-05-06).
- Crash reports: `~/.cache/hyprland/hyprlandCrashReport{1554,1583,1588,2634}.txt`.
- Journal evidence of repeated session restarts in boots `-3`, `-2`, `-1`.

### Related upstream issues (basecamp/omarchy)

- [#5457](https://github.com/basecamp/omarchy/issues/5457) (OPEN, 2026-04-26)
  — Hyprland-Crash after disabling laptop display while using mirrored
  external monitor. Same trigger script. Hotfix
  [PR #5462](https://github.com/basecamp/omarchy/pull/5462) only handles the
  mirror case. Vaxerski (Hyprland) commented on aquamarine 0.11.0.
- [#5602](https://github.com/basecamp/omarchy/issues/5602) (OPEN, 2026-05-05)
  — Hyprland crash after DP-1 hotplug on NVIDIA session. Identical Hyprland /
  aquamarine / nvidia-open-dkms versions, identical SIGSEGV → pixman follow-on,
  identical `xdg-desktop-portal-hyprland` SIGSEGV chain. Different reproducer
  (cable hotplug).
- [#5481](https://github.com/basecamp/omarchy/issues/5481) (OPEN, 2026-04-29)
  — Internal display toggle not re-applied after suspend/resume. Same
  `omarchy-hyprland-monitor-internal` design surfaced in a different scenario.

This scenario (lid switch + multi-monitor + NVIDIA hybrid + boot-with-lid-
closed) is **not yet filed**.

## Plan

Override the omarchy default lid-switch bindings with the surgical
`hyprctl keyword` form, in user config only. Avoid the `hyprctl reload` race
without touching `~/.local/share/omarchy/`.

### Scope decisions (already made)

- Override only the lid-switch bindings (`switch:on`/`switch:off`).
  `SUPER+CTRL+Delete` and the Hardware menu's "Toggle laptop display" entry
  still call the omarchy script and remain a residual sharp edge.
- Edit lives in `~/.config/hypr/bindings.conf`, which is already sourced after
  the omarchy defaults.
- Defensive cleanup of any stale `internal-monitor-disable.conf`.
- Upstream report: pending decision on whether to file a new issue or comment
  on [#5457](https://github.com/basecamp/omarchy/issues/5457).

### Implementation steps

1. **Append override** to `~/.config/hypr/bindings.conf`:

   ```
   # Override omarchy default lid handler.
   # omarchy-hyprland-monitor-internal {on,off} writes a toggle file and runs
   # `hyprctl reload`, which races with aquamarine on hybrid-GPU multi-monitor
   # setups (Hyprland 0.54.3) and crashes Hyprland. `hyprctl keyword monitor`
   # is atomic and avoids the race. See ~/.cache/hyprland/hyprlandCrashReport*.txt.
   unbind = , switch:on:Lid Switch
   unbind = , switch:off:Lid Switch
   bindl = , switch:on:Lid Switch, exec, hyprctl keyword monitor "eDP-1, disable"
   bindl = , switch:off:Lid Switch, exec, hyprctl keyword monitor "eDP-1, preferred, auto, auto"
   ```

2. **Remove any stale toggle file** (no-op today; idempotency safety):

   ```
   rm -f ~/.local/state/omarchy/toggles/hypr/internal-monitor-disable.conf
   ```

3. **Reload and validate**:

   ```
   hyprctl reload
   hyprctl configerrors
   ```

   Expected: `ok` / no errors. If there are errors, address before continuing.

### Files NOT touched

- `~/.config/hypr/monitors.conf` — keep `monitor=,preferred,auto,auto` as the
  catch-all so DP-6/DP-7 keep their preferred modes.
- `~/.config/hypr/hyprland.conf` — keeps sourcing all omarchy defaults.
- Anything in `~/.local/share/omarchy/` — never edit, per the omarchy skill.
- The mirror toggle, hardware menu, `SUPER+CTRL+Delete` keybinding — out of
  scope.

### Dotfiles consideration (heads-up)

`~/.config/hypr/` mixes symlinked and non-symlinked files:

| File | State |
| --- | --- |
| `hyprland.conf` | symlink → `~/src/dotfiles/hypr/.config/hypr/hyprland.conf` |
| `bindings.conf` | regular file, not in dotfiles |
| `hypridle.conf` | regular file (dotfiles copy is stale, Dec 2025) |
| `monitors.conf`, `input.conf`, `looknfeel.conf`, `autostart.conf`, etc. | regular files, not in dotfiles |

The dotfiles copy of `bindings.conf`
(`~/src/dotfiles/hypr/.config/hypr/bindings.conf`) is from Nov 2025 and
significantly behind the live file (which omarchy refreshed today).

The plan edits the **live** file at `~/.config/hypr/bindings.conf` directly.
After verifying the fix, decide separately whether to:

a. Bring the updated `bindings.conf` (and other hypr files) under stow so the
   override travels with the dotfiles repo, **or**
b. Leave them out and treat the override as machine-local.

Recommendation: option (a), because the override needs to be re-applied any
time omarchy regenerates `bindings.conf` (e.g. `omarchy refresh hyprland`). A
versioned dotfiles copy makes restoration trivial.

## Verification

After applying steps 1-3, manual checks:

1. `hyprctl monitors -j | jq '[.[] | .name]'` — should list `["eDP-1", "DP-6", "DP-7"]`.
2. Close lid manually:
   - `hyprctl monitors -j | jq '[.[] | .name]'` — should list `["DP-6", "DP-7"]`.
   - `ls ~/.cache/hyprland/hyprlandCrashReport*.txt` — should show no new reports.
   - Workspaces and apps on DP-6/DP-7 keep rendering.
3. Open lid:
   - `hyprctl monitors -j | jq '[.[] | .name]'` — should list `["eDP-1", "DP-6", "DP-7"]` again.
4. Reboot with lid closed (the original failure mode):
   - On login, externals are active, eDP-1 disabled, no fresh crash report.
   - `journalctl --user -b -u "wayland-wm@hyprland.desktop.service"` — clean,
     no `Hyprland has crashed :(` message.

## Rollback

If the fix misbehaves:

```bash
# Remove the override block from ~/.config/hypr/bindings.conf
# (hand-edit, or restore from ~/.config/hypr/bindings.conf.bak.1778071231 if needed)
hyprctl reload
hyprctl configerrors
```

The omarchy defaults at
`~/.local/share/omarchy/default/hypr/bindings/utilities.conf` resume control
the moment our `unbind`/`bindl` lines are removed.

## Out of scope (tracked for later)

- **Residual crash path** via `SUPER+CTRL+Delete` and Hardware menu still
  invoke `omarchy-hyprland-monitor-internal toggle`. Same race; same crash if
  pressed manually with externals attached. Could be addressed later by
  rebinding to `hyprctl keyword monitor` calls.
- **Hyprland upgrade** — Omarchy pins `hyprland 0.54.3-4`. Upstream bug may be
  fixed in newer aquamarine; out of scope until omarchy bumps the pin or we
  decide to deviate.
- **Upstream report** — decide between new issue vs. comment on
  [#5457](https://github.com/basecamp/omarchy/issues/5457). If filing new,
  required fields (per `.github/ISSUE_TEMPLATE/bug.yml`):
  - System details (Dell Precision 7760, Intel Tiger Lake + NVIDIA T1200,
    Omarchy 3.7.x, Hyprland 0.54.3, aquamarine 0.11.0).
  - "What's wrong?" with steps to reproduce.
  - `omarchy debug --no-sudo --print` output attached.
- **Dotfiles hygiene** — bring `bindings.conf`, `monitors.conf`, etc. under
  stow, refresh stale copies in the dotfiles repo, decide naming/layout.

## Open questions

- File a new upstream issue, comment on #5457, or skip? (Pending user.)
- After verifying, do we also rebind `SUPER+CTRL+Delete` to avoid the residual
  manual-toggle crash? (Pending user.)
- Bring hypr configs under stow as part of this work, or punt to a separate
  pass? (Pending user.)
