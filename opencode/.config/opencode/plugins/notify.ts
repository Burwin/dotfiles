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
 * id captured via `notify-send -p` and stored in a per-session list. The
 * default switch arm below runs `makoctl dismiss -n <id>` for each tracked
 * id whenever any non-halting event arrives for that session — i.e. as
 * soon as the agent / user demonstrably resumes work, the residual alert
 * is cleared. `session.status` is explicitly skipped because it is
 * overloaded (fires for idle, busy, and retry) and would otherwise race
 * with `session.idle` and dismiss the toast we just raised. Tracking is
 * intentionally session-level, not per-toast: two outstanding alerts for
 * one session both clear on the first response — by then you're engaged
 * with that session anyway. `makoctl dismiss` is best-effort (stale or
 * expired ids are harmless no-ops, errors swallowed). ntfy phone alerts
 * are NOT dismissed — phones don't reliably know you've returned to the
 * laptop.
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

  // sessionID → mako notification ids currently on screen for that session.
  // Cleared wholesale on the first non-halting event for the session (see
  // the `default` arm of the event switch). `delete()` on dismiss keeps the
  // map bounded over a long-lived process.
  const notificationIDs = new Map<string, number[]>()

  // Single entry point that fans out to both transports in parallel.
  // notify-send keeps its `urgency` arg unchanged; ntfy ignores urgency
  // and uses default priority (3) for every event. When `sessionID` is
  // provided, the mako notification id printed by `notify-send -p` is
  // captured and appended to that session's id list so the default switch
  // arm can later dismiss it.
  const notify = async (
    urgency: "low" | "normal" | "critical",
    title: string,
    body: string,
    tags?: string,
    sessionID?: string,
  ) => {
    // `.text()` auto-calls `.quiet()` so the printed id no longer leaks to
    // the user's terminal. `.nothrow()` keeps the existing crash-proof
    // contract for missing/failing notify-send; the trailing `.catch(() =>
    // "")` is belt-and-braces for shell-spawn failures (e.g. notify-send
    // not on PATH at all) which can throw even with `.nothrow()`.
    const [stdoutText] = await Promise.all([
      $`notify-send -a opencode -u ${urgency} -p ${title} ${body}`
        .nothrow()
        .text()
        .catch(() => ""),
      pingNtfy(title, body, tags),
    ])
    if (sessionID) {
      const id = Number.parseInt(stdoutText.trim(), 10)
      if (Number.isFinite(id)) {
        const arr = notificationIDs.get(sessionID) ?? []
        arr.push(id)
        notificationIDs.set(sessionID, arr)
      }
    }
  }

  // Best-effort dismissal of every tracked toast for a session. Stale or
  // already-expired ids are harmless no-ops in mako, so we don't bother
  // diffing against `makoctl list`. `delete` runs before the awaited
  // dismisses so a slow `makoctl` cannot cause a duplicate dismiss on a
  // re-entrant event.
  const dismissAll = async (sessionID: string) => {
    const ids = notificationIDs.get(sessionID)
    if (!ids || ids.length === 0) return
    notificationIDs.delete(sessionID)
    await Promise.all(
      ids.map((id) =>
        $`makoctl dismiss -n ${id}`
          .nothrow()
          .quiet()
          .catch(() => {}),
      ),
    )
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
            titleBase,
            "Session idle — ready for input",
            "robot",
            p.sessionID,
          )
          break
        case "session.error":
          await notify(
            "critical",
            titleBase,
            "Session error",
            "warning",
            p.sessionID,
          )
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
          await notify("critical", titleBase, body, "lock", p.sessionID)
          break
        }
        case "question.asked": {
          // QuestionInfo.header is guaranteed ≤30 chars — fits cleanly in a toast.
          const header = p.questions?.[0]?.header
          const body =
            typeof header === "string" && header.trim()
              ? `Question: ${header.trim()}`
              : "Question awaiting answer"
          await notify("critical", titleBase, body, "question", p.sessionID)
          break
        }
        case "session.status":
          // Overloaded event: fires for status=idle, status=busy, status=retry.
          // Skip so we don't race with `session.idle` (both fire near-
          // simultaneously at end-of-turn) and dismiss the toast we just
          // raised. The next "real" session event (message.updated,
          // tool.execute.before, etc.) hits the default arm and dismisses
          // within milliseconds anyway.
          break
        default:
          // Halting events handled explicitly above; anything else for a
          // known session means the agent / user is moving again ⇒ clear
          // the toasts. Events without a sessionID (installation.updated,
          // server.connected, file.watcher.updated, etc.) are silently
          // ignored.
          if (p.sessionID) await dismissAll(p.sessionID)
      }
    },
  }
}
