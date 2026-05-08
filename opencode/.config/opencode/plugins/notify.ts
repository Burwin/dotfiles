import type { Plugin } from "@opencode-ai/plugin"
import { dispatchEvent, makeDismissTracker, pingNtfy } from "./notify/lib.ts"

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
 * Title: the bold first line of every toast (and the title of every ntfy
 * push) is the current tmux session name, resolved once at plugin load
 * via `tmux display-message -p '#S'`. When opencode is launched outside
 * tmux the lookup degrades silently and the title falls back to
 * "OpenCode". The session name makes it possible to tell at a glance
 * which terminal needs attention when juggling several concurrent
 * opencode runs across tmux windows or separate phones.
 *
 * notify-send: the `-a opencode` flag tags the notification's app-name so
 * mako rules can style/route opencode toasts independently if desired
 * (see ~/.config/mako/config). `.nothrow()` ensures a missing or failing
 * notify-send never bubbles up and crashes the plugin runtime — opencode
 * keeps working silently in that case.
 *
 * Auto-dismiss (mako only): every toast we raise has its mako notification
 * id captured via `notify-send -p` and stored in a per-session list (see
 * `makeDismissTracker` in ./notify/lib.ts). The default dispatch arm runs
 * `makoctl dismiss -n <id>` for each tracked id whenever any non-halting
 * event arrives for that session — i.e. as soon as the agent / user
 * demonstrably resumes work, the residual alert is cleared. `session.status`
 * is explicitly skipped because it is overloaded (fires for idle, busy, and
 * retry) and would otherwise race with `session.idle` and dismiss the toast
 * we just raised. Tracking is intentionally session-level, not per-toast:
 * two outstanding alerts for one session both clear on the first response —
 * by then you're engaged with that session anyway. `makoctl dismiss` is
 * best-effort (stale or expired ids are harmless no-ops, errors swallowed).
 * ntfy phone alerts are NOT dismissed — phones don't reliably know you've
 * returned to the laptop.
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
 * at the single call site in `pingNtfy` (./notify/lib.ts) if you ever want
 * a louder/quieter alert (e.g. priority 5 to bypass Do Not Disturb on Android).
 *
 * Permission shape note: the `event.properties` for `permission.asked`
 * empirically carries v2 SDK keys (`permission` for the action type,
 * `patterns` array, no `title`) but the v1 type definitions imported via
 * `@opencode-ai/plugin@1.4.7` describe a different shape. The mapping in
 * `dispatchEvent` (./notify/lib.ts) accepts either shape — `title` if
 * present, `permission` as the v2 fallback, generic body otherwise.
 *
 * Testability: the bulk of this plugin's logic lives in ./notify/lib.ts
 * and is exercised by ./notify/test.ts. This file owns env-var resolution
 * + the `$`-bound side effects only.
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

const ntfyConfig = {
  server: OPENCODE_IDLE_NTFY_SERVER,
  topic: OPENCODE_IDLE_NTFY_TOPIC,
  token: OPENCODE_IDLE_NTFY_TOKEN,
}

export const NotifyPlugin: Plugin = async ({ $ }) => {
  // Tmux session name, resolved once at plugin load and used as every
  // toast/push title (see docstring). The lookup is gated on `TMUX`
  // being set in the env: `tmux display-message` connects to the
  // default server even when invoked outside a client and returns the
  // most-recently-active session, which would otherwise mislabel
  // notifications from an opencode launched outside tmux. `.nothrow()`
  // plus the empty-string fallback also handles a dead tmux server. We
  // trim then strip CR/LF belt-and-braces for HTTP header safety on the
  // ntfy `Title:` header — tmux session names are conventionally
  // [A-Za-z0-9_-] but `rename-session` accepts anything, and a stray
  // newline would corrupt the request line.
  const tmuxSession = process.env.TMUX
    ? (
        await $`tmux display-message -p '#S'`
          .nothrow()
          .quiet()
          .text()
          .catch(() => "")
      )
        .trim()
        .replace(/[\r\n]+/g, " ")
    : ""
  const titleBase = tmuxSession || "OpenCode"

  // The dismiss tracker holds the per-session mako-id lists. The injected
  // dismiss callback drives `makoctl dismiss -n <id>` via Bun's `$`; errors
  // are swallowed so a missing makoctl / dbus failure can't crash the plugin.
  const tracker = makeDismissTracker(async (id) => {
    await $`makoctl dismiss -n ${id}`
      .nothrow()
      .quiet()
      .catch(() => {})
  })

  return {
    event: async ({ event }) => {
      // The v1 Event union doesn't include `permission.asked` / `question.*`
      // (those are v2 names) but the runtime delivers them at runtime per the
      // docs. Cast once and dispatch on a free-form string via the lib.
      const e = event as unknown as {
        type: string
        properties?: Record<string, unknown>
      }
      const action = dispatchEvent(e.type, e.properties ?? {}, titleBase)
      switch (action.kind) {
        case "noop":
          return
        case "dismiss":
          await tracker.dismissAll(action.sessionID)
          return
        case "notify": {
          // Fire both transports in parallel. notify-send -p prints the mako
          // notification id to stdout; capture it for the dismiss tracker.
          // ntfy ignores `urgency` (every event uses default priority 3).
          const [stdoutText] = await Promise.all([
            $`notify-send -a opencode -u ${action.urgency} -p ${action.title} ${action.body}`
              .nothrow()
              .text()
              .catch(() => ""),
            pingNtfy(ntfyConfig, action.title, action.body, action.tag),
          ])
          if (action.sessionID) {
            const id = Number.parseInt(stdoutText.trim(), 10)
            tracker.tryAdd(action.sessionID, id)
          }
          return
        }
      }
    },
  }
}
