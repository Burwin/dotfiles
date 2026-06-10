Multi-monitor Intel i915 variant of this wedge on Hyprland 0.55.2-1 + aquamarine 0.11.0-2 (Arch — no f5cdaa8). Trigger is plain lid close (no suspend), and the wedge surfaces on the **external** monitors sharing the i915, not on the eDP being disabled.

Dell Precision 7760. Intel Tiger Lake-H iGPU `[8086:9a70]` (`i915`) driving all three monitors (eDP-1 + DP-6 + DP-7); NVIDIA T1200 dGPU dormant on this boot. UWSM + atomic DRM, no `AQ_NO_ATOMIC`.

On the first lid close after a fresh Hyprland start, my `bindl` runs `hyprctl keyword monitor "eDP-1, disable"`. eDP-1 disables cleanly. DP-6 and DP-7 wedge: backlight on, framebuffer frozen, HW cursor still moves. Opening the lid alone doesn't recover; need lid open + mouse movement to nudge them back. Subsequent close/open cycles in the same session are fine.

Log slice around the event:

```
[libinput] event17 - lid: suspending touchpad
drm: Disabling output eDP-1
drm: Modesetting DP-6 with 1920x1080@60.00Hz
ERR drm: Cannot commit when a page-flip is awaiting
drm: Modesetting DP-7 with 1920x1080@60.00Hz
drm: Modesetting DP-6 with 1920x1080@60.00Hz
[libinput] event17 - lid: resume touchpad
```

The stranded page-flip is on DP-6, not the eDP-1 being disabled. The disable forces a modeset cascade across the i915 connectors and one of the externals' page-flips never resolves. `hyprctl monitors -j` snapshots before and after the event report all three monitors active and dpms-on — Hyprland doesn't see the wedge.

Page-flip error counts for the session: 3 during startup, 14 in a 113s capture window. Only 1 of the 14 is the wedge itself; the rest are the same generic race firing during pre-lid activity.

What I've tried that doesn't help: focusing a non-eDP-1 monitor before the disable; using `hyprctl keyword monitor` instead of `hyprctl reload` (this killed an earlier crash family on this machine — basecamp/omarchy#5457 — but doesn't prevent this wedge). Haven't tested `AQ_NO_ATOMIC=1` yet; will follow up.

`dmesg` is restricted here so kernel-side data is thin — can re-run with `sudo dmesg -w` in parallel from a fresh session if richer `i915` messages would help.
