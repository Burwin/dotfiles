# Hyprland Lid Switch Investigation

**Date**: 2026-05-07
**Status**: implemented; archived 2026-05-18.

> Fix lives in:
> - `~/.config/hypr/autostart.conf` (symlinked into the dotfiles repo at
>   `hypr/.config/hypr/autostart.conf`).
> - `exec-once` shell check that runs `hyprctl keyword monitor "eDP-1, disable"`
>   if `/proc/acpi/button/lid/LID*/state` reports `closed` at Hyprland startup.
> - Uses the same atomic `hyprctl keyword monitor` call as `bindings.conf`, so
>   it avoids the aquamarine reload race from the 2026-05-06 crash plan.
>
> Preserved for decision history.

## Problem

1. Boot with lid closed → laptop screen stays active (eDP-1), no crash (after yesterday's fix)
2. Close lid while running → laptop screen stays active, no crash (after yesterday's fix)

## Background

Yesterday (2026-05-06), a fix was applied to prevent Hyprland crashes when the lid is closed. The crash was caused by `omarchy-hyprland-monitor-internal` using `hyprctl reload` which triggers an aquamarine race condition on hybrid-GPU multi-monitor setups.

The fix replaced the omarchy default bindings with direct `hyprctl keyword monitor` commands in `~/.config/hypr/bindings.conf`:
```
unbind = , switch:on:Lid Switch
unbind = , switch:off:Lid Switch
bindl = , switch:on:Lid Switch, exec, hyprctl keyword monitor "eDP-1, disable"
bindl = , switch:off:Lid Switch, exec, hyprctl keyword monitor "eDP-1, preferred, auto, auto"
```

## Root Cause

The `bindl = , switch:on:Lid Switch` binding only fires on **state transitions** (open→closed). When:
- Booting with lid already closed - no transition occurred since Hyprland started
- Starting Hyprland with lid already closed - the event was missed

This is a known Hyprland limitation - it doesn't detect the initial state of switches on startup, only transitions.

## Evidence

- `cat /proc/acpi/button/lid/LID0/state` returns `state: closed`
- `hyprctl devices` shows "Lid Switch" as the switch device name
- `hyprctl monitors` shows eDP-1 still active despite lid being closed

## Solution

1. **Immediate**: Run `hyprctl keyword monitor "eDP-1, disable"` to disable the laptop screen
2. **Startup fix**: Add a check in `~/.config/hypr/autostart.conf` to check lid state on Hyprland startup and disable eDP-1 if lid is closed

## Verification

After applying startup fix:
1. Reboot with lid closed → eDP-1 should be disabled automatically
2. Close lid while running → eDP-1 should disable via the transition binding
3. Open lid → eDP-1 should re-enable via the `switch:off` binding

## References

- Hyprland Wiki: https://wiki.hypr.land/Configuring/Binds
- Previous commit: `b7f4d96` - "fix hyprland lid crashing"
- Issue: Hyprland issue #6773 (Lid Switch not working)