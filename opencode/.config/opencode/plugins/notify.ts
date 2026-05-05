import type { Plugin } from "@opencode-ai/plugin"

/**
 * Native OS notifications + optional ntfy phone alerts for opencode on Linux
 * (omarchy: mako via libnotify).
 *
 * Fires `notify-send` whenever a session needs the user's attention, and —
 * when `OPENCODE_IDLE_NTFY_TOPIC` is set — additionally POSTs the same
 * message to ntfy so a phone subscribed to that topic gets a push
 * notification too.
 *
 * Both transports fire for the same four events (see
 * https://opencode.ai/docs/plugins#events for the full event list):
 *
 *   session.idle        normal     "Session idle — ready for input"   tag: robot
 *   session.error       critical   "Session error"                    tag: warning
 *   permission.asked    critical   "Permission requested: <detail>"   tag: lock
 *   question.asked      critical   "Question: <header>"               tag: question
 *
 * notify-send: the `-a opencode` flag tags the notification's app-name so
 * mako rules can style/route opencode toasts independently if desired
 * (see ~/.config/mako/config). `.nothrow()` ensures a missing or failing
 * notify-send never bubbles up and crashes the plugin runtime — opencode
 * keeps working silently in that case.
 *
 * ntfy: best-effort, never crashes the plugin runtime. Configured via env:
 *
 *   OPENCODE_IDLE_NTFY_TOPIC (required)
 *     Without it, the ntfy fan-out is a silent no-op, so machines without
 *     ntfy configured behave exactly as before this fan-out existed.
 *     Treated as a secret (anyone with it can subscribe), so it MUST come
 *     from the environment, not this dotfiles repo.
 *
 *   OPENCODE_IDLE_NTFY_SERVER (optional, default https://ntfy.sh)
 *     Trailing slashes stripped, so a self-hosted instance with a path
 *     prefix (e.g. https://example.com/ntfy) works.
 *
 *   OPENCODE_IDLE_NTFY_TOKEN (optional)
 *     Sent as `Authorization: Bearer ...` for protected topics on
 *     self-hosted servers.
 *
 * Every ntfy POST has a 5s `AbortSignal.timeout` so a slow/dead server
 * cannot block subsequent event handling, and all errors are swallowed —
 * mirroring the `.nothrow()` philosophy of the notify-send call. Bun's
 * native `fetch` is used; no curl subprocess and no extra deps.
 *
 * Priority: every event currently uses ntfy's default priority (3). Change
 * at the single call site in `pingNtfy` if you ever want a louder/quieter
 * alert (e.g. priority 5 to bypass Do Not Disturb on Android).
 *
 * Permission shape note: the `event.properties` for `permission.asked`
 * empirically carries v2 SDK keys (`permission` for the action type,
 * `patterns` array, no `title`) but the v1 type definitions imported via
 * `@opencode-ai/plugin@1.4.7` describe a different shape. We accept either
 * shape — `title` if present (descriptive), `permission` as the v2 fallback,
 * generic body otherwise.
 */

// Module-level config: read once at plugin load. Trailing slashes on
// OPENCODE_IDLE_NTFY_SERVER are stripped so concatenation with the topic
// segment always produces a well-formed URL. OPENCODE_IDLE_NTFY_TOPIC
// unset ⇒ pingNtfy is a no-op.
const OPENCODE_IDLE_NTFY_SERVER = (
  process.env.OPENCODE_IDLE_NTFY_SERVER || "https://ntfy.sh"
).replace(/\/+$/, "")
const OPENCODE_IDLE_NTFY_TOPIC = process.env.OPENCODE_IDLE_NTFY_TOPIC
const OPENCODE_IDLE_NTFY_TOKEN = process.env.OPENCODE_IDLE_NTFY_TOKEN

const pingNtfy = async (title: string, body: string, tags?: string) => {
  if (!OPENCODE_IDLE_NTFY_TOPIC) return
  const headers: Record<string, string> = {
    Title: title,
    "Content-Type": "text/plain; charset=utf-8",
  }
  if (tags) headers.Tags = tags
  if (OPENCODE_IDLE_NTFY_TOKEN) {
    headers.Authorization = `Bearer ${OPENCODE_IDLE_NTFY_TOKEN}`
  }
  try {
    // encodeURIComponent is purely defensive — ntfy topics are restricted
    // to [A-Za-z0-9_-] per the spec, but if someone ever set
    // OPENCODE_IDLE_NTFY_TOPIC to a malformed value we still produce a
    // syntactically valid URL.
    const url = `${OPENCODE_IDLE_NTFY_SERVER}/${encodeURIComponent(OPENCODE_IDLE_NTFY_TOPIC)}`
    await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    // best-effort: a missing/dead ntfy server must never crash the plugin
  }
}

export const NotifyPlugin: Plugin = async ({ $ }) => {
  // Single entry point that fans out to both transports in parallel.
  // notify-send keeps its `urgency` arg unchanged; ntfy ignores urgency
  // and uses default priority (3) for every event.
  const notify = async (
    urgency: "low" | "normal" | "critical",
    title: string,
    body: string,
    tags?: string,
  ) => {
    await Promise.all([
      $`notify-send -a opencode -u ${urgency} ${title} ${body}`.nothrow(),
      pingNtfy(title, body, tags),
    ])
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
          await notify(
            "normal",
            "OpenCode",
            "Session idle — ready for input",
            "robot",
          )
          break
        case "session.error":
          await notify("critical", "OpenCode", "Session error", "warning")
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
          await notify("critical", "OpenCode", body, "lock")
          break
        }
        case "question.asked": {
          // QuestionInfo.header is guaranteed ≤30 chars — fits cleanly in a toast.
          const header = p.questions?.[0]?.header
          const body =
            typeof header === "string" && header.trim()
              ? `Question: ${header.trim()}`
              : "Question awaiting answer"
          await notify("critical", "OpenCode", body, "question")
          break
        }
      }
    },
  }
}
