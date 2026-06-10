# Atomic DRM wedge evidence — candidate C, 2026-06-10

Captured from the user's first lid close+open cycle in a fresh
session with `AQ_NO_ATOMIC` unset (production state, atomic DRM).
Candidate C (mirror+dpms, commit `cef7a7a`) was active. Wedge
reproduced (user-confirmed standard repro: externals went black
with cursor still moving on lid close, recovered with mouse-jiggle
on lid open). One cycle observed.

## System

| Item | Value |
| --- | --- |
| Hyprland | 0.55.2-1 |
| Aquamarine | 0.11.0-2 |
| Hyprutils | 0.13.1-1 |
| Mesa | 26.1.1-2 |
| nvidia-open-dkms | 595.71.05-2 |
| nvidia-utils | 595.71.05-2 |
| Kernel | 7.0.9-arch2-1 |
| iGPU device | `/dev/dri/card2` (Intel TGL UHD, `8086:9a70`) |
| Render device | `/dev/dri/renderD129` |
| DRM iface | atomic (per `drm: Atomic supported, using atomic for modesetting`) |
| `AQ_NO_ATOMIC` | unset (verified via `cat /proc/<pid>/environ`) |

## Page-flip error tally

| Phase | Count | Lines |
| --- | --- | --- |
| Initial bring-up (3-monitor modeset) | 13 | 363–395 |
| Mystery cluster (~post-libinput-register, pre-lid-event) | 5 | 423–427 |
| Lid close cascade | 2 | 442, 444 |
| Lid open cascade | 0 | — |
| **Total in session** | **20** | — |

Note: the "mystery cluster" at lines 423–427 fires after libinput
registers the Lid Switch device (line 416) but before any user
lid-close event (`lid: suspending touchpad` at line 439). Possible
causes: hyprlock unlock cascade, late-arriving DPMS state from
boot, or a second-pass monitor re-evaluation. Worth investigating
if work resumes — could be an additional source of stranded
page-flips that compounds the lid event.

## Lid close behaviour (lines 439–456)

```
439: [libinput] event13 - lid: suspending touchpad        ← lid close
441: drm: Modesetting eDP-1                                ← (dpms off? or mirror?)
442: ERR drm: Cannot commit when a page-flip is awaiting  ← page-flip strand #1
443: drm: Modesetting DP-6                                 ← UNEXPECTED cascade onto external
444: ERR drm: Cannot commit when a page-flip is awaiting  ← page-flip strand #2
445: drm: Modesetting DP-7                                 ← UNEXPECTED cascade onto external
446: drm: Modesetting eDP-1
447: drm: Modesetting DP-6
456: drm: Modesetting eDP-1
```

## Lid open behaviour (lines 459–464)

```
459: [libinput] event13 - lid: resume touchpad            ← lid open
461: drm: Modesetting eDP-1
462: drm: Modesetting eDP-1
463: drm: Modesetting DP-6
464: drm: Modesetting DP-7
```

Clean — no page-flip errors on the open cascade. Matches our
prior observation that opening the lid never wedges; only closing
does.

## Disconfirmation summary

- **Legacy DRM (prior test, 2026-06-10 morning):** mirror entry
  produced 0 cascade lines. No wedge.
- **Atomic DRM (this test, 2026-06-10 afternoon):** mirror entry
  cascades onto DP-6 and DP-7, fires 2 page-flip errors, wedges
  the externals.

The cascade-free claim from the legacy probe does **not** transfer
to atomic. On atomic, applying `keyword monitor "eDP-1, ..., mirror,
DP-6"` triggers Hyprland's atomic-commit path to re-modeset all
connectors that share a CRTC with the changed monitor, even though
the mirror is logically just remapping eDP-1's coord space.

## Monitor state at end of cycle (post-recovery)

```json
[
  {"name":"DP-6","x":0,"y":0,"dpmsStatus":true,"mirrorOf":"none","disabled":false},
  {"name":"DP-7","x":1920,"y":0,"dpmsStatus":true,"mirrorOf":"none","disabled":false},
  {"name":"eDP-1","x":3840,"y":0,"dpmsStatus":true,"mirrorOf":"none","disabled":false}
]
```

System recovered to normal layout after lid open + mouse-jiggle.
No persistent state damage.
