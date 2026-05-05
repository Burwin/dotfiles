import type { Plugin } from "@opencode-ai/plugin"

/**
 * Native OS notifications for opencode on Linux (omarchy: mako via libnotify).
 *
 * Fires `notify-send` whenever a session needs the user's attention:
 *
 *   session.idle        normal urgency   "Session idle — ready for input"
 *   permission.updated  critical         "Permission requested: <title>"
 *   session.error       critical         "Session error"
 *
 * Note on event names: opencode's v1 SDK (the one the Plugin runtime is built
 * on as of @opencode-ai/plugin@1.4.7) emits `permission.updated` when a new
 * permission prompt appears. The v2 SDK additionally exposes `permission.asked`
 * — the official plugin docs list both, but only `permission.updated` is what
 * the runtime delivers to a Plugin's `event` hook today.
 *
 * The `-a opencode` flag tags the notification's app-name so mako rules can
 * style/route opencode toasts independently if desired
 * (see ~/.config/mako/config).
 *
 * `.nothrow()` ensures a missing or failing notify-send never bubbles up and
 * crashes the plugin runtime — opencode keeps working silently in that case.
 */
export const NotifyPlugin: Plugin = async ({ $ }) => {
  const notify = async (
    urgency: "low" | "normal" | "critical",
    title: string,
    body: string,
  ) => {
    await $`notify-send -a opencode -u ${urgency} ${title} ${body}`.nothrow()
  }

  return {
    event: async ({ event }) => {
      switch (event.type) {
        case "session.idle":
          await notify("normal", "OpenCode", "Session idle — ready for input")
          break
        case "permission.updated": {
          const detail = event.properties?.title?.trim()
          const body = detail
            ? `Permission requested: ${detail}`
            : "Permission requested"
          await notify("critical", "OpenCode", body)
          break
        }
        case "session.error":
          await notify("critical", "OpenCode", "Session error")
          break
      }
    },
  }
}
