import type { Plugin } from "@opencode-ai/plugin"

/**
 * Native OS notifications for opencode on Linux (omarchy: mako via libnotify).
 *
 * Fires `notify-send` whenever a session needs the user's attention:
 *
 *   session.idle (event)                          normal     "Session idle — ready for input"
 *   session.error (event)                         critical   "Session error"
 *   permission.ask (hook)                         critical   "Permission requested: <detail>"
 *   tool.execute.before, tool === "question"      critical   "Question: <header>"
 *
 * Note on event vs hook architecture: the opencode runtime delivers ask-side
 * signals through dedicated *hooks* (`permission.ask`, `tool.execute.before`),
 * not via the generic `event` bus. The bus only fires reply-side events
 * (`permission.replied`, `session.idle`, `session.error`). See ./toggl-time.ts
 * for the matching split there.
 *
 * Permission shape note: the v1 SDK `Permission` payload (typed via
 * `@opencode-ai/plugin@1.4.7`) carries a descriptive `title`. A future v2
 * `PermissionRequest` payload would instead carry a coarse `permission`
 * string (e.g. "bash", "edit"). The hook below reads either and falls back
 * to a generic body.
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
        case "session.error":
          await notify("critical", "OpenCode", "Session error")
          break
      }
    },
    "permission.ask": async (input) => {
      // v1 Permission has `title`; a v2 PermissionRequest would instead have
      // `permission`. Accept either, fall through to a generic body.
      const i = input as unknown as { title?: unknown; permission?: unknown }
      const detail =
        (typeof i.title === "string" && i.title.trim()) ||
        (typeof i.permission === "string" && i.permission.trim())
      const body = detail
        ? `Permission requested: ${detail}`
        : "Permission requested"
      await notify("critical", "OpenCode", body)
      // Intentionally does NOT mutate `output.status` — pure observer.
    },
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "question") return
      // QuestionInfo.header is guaranteed ≤30 chars — fits cleanly in a toast.
      const header = output.args?.questions?.[0]?.header
      const body =
        typeof header === "string" && header.trim()
          ? `Question: ${header.trim()}`
          : "Question awaiting answer"
      await notify("critical", "OpenCode", body)
    },
  }
}
