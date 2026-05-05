import type { Plugin } from "@opencode-ai/plugin"

/**
 * Native OS notifications for opencode on Linux (omarchy: mako via libnotify).
 *
 * Fires `notify-send` whenever a session needs the user's attention. All
 * signals come from the documented `event` hook (see
 * https://opencode.ai/docs/plugins#events for the full event list):
 *
 *   session.idle        normal     "Session idle — ready for input"
 *   session.error       critical   "Session error"
 *   permission.asked    critical   "Permission requested: <detail>"
 *   question.asked      critical   "Question: <header>"
 *
 * Permission shape note: the `event.properties` for `permission.asked`
 * empirically carries v2 SDK keys (`permission` for the action type,
 * `patterns` array, no `title`) but the v1 type definitions imported via
 * `@opencode-ai/plugin@1.4.7` describe a different shape. We accept either
 * shape — `title` if present (descriptive), `permission` as the v2 fallback,
 * generic body otherwise.
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
      // The v1 Event union doesn't include `permission.asked` / `question.*`
      // (those are v2 names) but the runtime delivers them at runtime per the
      // docs. Cast once and switch on a free-form string.
      const e = event as unknown as { type: string; properties?: any }
      const p = e.properties ?? {}
      switch (e.type) {
        case "session.idle":
          await notify("normal", "OpenCode", "Session idle — ready for input")
          break
        case "session.error":
          await notify("critical", "OpenCode", "Session error")
          break
        case "permission.asked": {
          // Body resolution: v1 `title` (descriptive), then v2 `permission`
          // (coarse: "bash", "edit"), then generic.
          const detail =
            (typeof p.title === "string" && p.title.trim()) ||
            (typeof p.permission === "string" && p.permission.trim())
          const body = detail
            ? `Permission requested: ${detail}`
            : "Permission requested"
          await notify("critical", "OpenCode", body)
          break
        }
        case "question.asked": {
          // QuestionInfo.header is guaranteed ≤30 chars — fits cleanly in a toast.
          const header = p.questions?.[0]?.header
          const body =
            typeof header === "string" && header.trim()
              ? `Question: ${header.trim()}`
              : "Question awaiting answer"
          await notify("critical", "OpenCode", body)
          break
        }
      }
    },
  }
}
