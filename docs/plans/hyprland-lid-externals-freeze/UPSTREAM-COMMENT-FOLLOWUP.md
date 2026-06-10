Followup: tested `AQ_NO_ATOMIC=1` on this same multi-monitor i915 setup — does **not** prevent the wedge.

Setup unchanged (Dell Precision 7760, Intel TGL iGPU driving eDP-1 + DP-6 + DP-7, Hyprland 0.55.2-1 + aquamarine 0.11.0-2 on Arch). Set `export AQ_NO_ATOMIC=1` in `~/.config/uwsm/env`, restarted the machine, confirmed in the log:

```
WARN from aquamarine ]: drm: AQ_NO_ATOMIC enabled, using the legacy drm iface
```

…on both `card1` (NVIDIA, dormant) and `card2` (Intel, all active connectors). Modeset lines now read `legacy drm: Modesetting CRTC <id>` instead of the atomic path.

First lid close after restart: same wedge. DP-6/DP-7 backlight on, framebuffer frozen, HW cursor still moves. Recovered on lid open + mouse motion as before.

Importantly, the `Cannot commit when a page-flip is awaiting` errors still fire on the legacy iface — 12 during session startup, 5 in the test window — so that error message is **not** atomic-iface-specific despite the wording. The lid-close test window log slice is identical in shape to the atomic run:

```
drm: Disabling output eDP-1
legacy drm: Modesetting CRTC 169, mode null
legacy drm: Modesetting CRTC 307
drm: Modesetting DP-6 with 1920x1080@60.00Hz
ERR drm: Cannot commit when a page-flip is awaiting
legacy drm: Modesetting CRTC 445
drm: Modesetting DP-7 with 1920x1080@60.00Hz
```

So in this multi-monitor i915 configuration, AQ_NO_ATOMIC reaches a different code path but ends up in the same wedge state. The symptom and the diagnostic error appear to be downstream of the atomic-vs-legacy choice — likely in connector enable/disable sequencing during clustered modesets, or kernel-side in `i915`.

One side effect worth flagging for anyone considering AQ_NO_ATOMIC as a workaround: aquamarine logs `ERR drm: No support for gamma on the legacy iface` on every modeset, and gamma-dependent features (night light) stop working. So even when it helps, it has a real cost on Wayland-with-color-management setups.

Reverted the env edit. Next thing I'll try locally is replacing `hyprctl keyword monitor "eDP-1, disable"` with `hyprctl dispatch dpms off eDP-1` to see if avoiding the connector-disable (and the resulting modeset cascade across DP-6/DP-7) sidesteps the wedge — will report back.
