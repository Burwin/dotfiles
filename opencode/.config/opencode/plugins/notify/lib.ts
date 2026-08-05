// notify/lib.ts — pure helpers for the opencode notify plugin (../notify.ts).
//
// The plugin entrypoint composes these into the runtime behavior described
// in ../notify.ts; everything testable lives here so it can be exercised
// without the opencode plugin runtime, mako, or a real ntfy server.
//
// Lives in this `notify/` subdirectory (not next to notify.ts) because
// opencode's plugin loader uses the non-recursive glob
// `{plugin,plugins}/*.{ts,js}` — anything at the top level of plugins/ is
// imported as a Plugin entrypoint, which would fail for these helpers and
// for the test file. Subdirectories are not scanned.
//
// Four pieces are factored out:
//
//   dispatchEvent(type, properties, titleBase) — pure mapping from an
//     opencode event tuple to the action the plugin should take. Returns
//     one of three discriminated unions: a "notify" action carrying the
//     fields the entrypoint feeds to notify-send + ntfy; a "dismiss"
//     action (plain sessionID payload); or a "noop" for the explicit
//     skip cases (sticky-noop for non-resume events, `session.status`,
//     events without a sessionID, etc.).
//
//   pingNtfy(config, title, body, tags?) — best-effort POST to ntfy.
//     Silently no-ops when the topic is empty (matching the
//     OPENCODE_IDLE_NTFY_TOPIC=unset semantics in the entrypoint).
//     5-second AbortSignal.timeout; all errors swallowed.
//
//   makeDismissTracker(dismiss) — factory for the per-session mako-id
//     bookkeeping. The injected `dismiss` function is invoked once per
//     tracked id when `dismissAll(sessionID)` runs; the entrypoint passes
//     a Bun-`$`-driven implementation, tests pass a mock.
//
//   tmuxSlug(name) — sanitize a tmux session name into a filesystem-safe
//     marker-file key (../notify.ts writes ~/.local/state/opencode/paused/
//     <slug>). Pure so the path-traversal guard is unit-testable.
//
// All four are intentionally side-effect-free at module load (no env
// reads, no global state). The entrypoint owns env-var resolution and
// shell/$-bound state.

export type Urgency = "low" | "normal" | "critical"

export type NotifyAction = {
  kind: "notify"
  urgency: Urgency
  title: string
  body: string
  tag: string
  sessionID?: string
}

export type DismissAction = {
  kind: "dismiss"
  sessionID: string
}

export type NoopAction = { kind: "noop" }

export type Action = NotifyAction | DismissAction | NoopAction

// dispatchEvent — pure event-type → action mapping (sticky-halt semantics).
//
//   session.idle / session.error / permission.asked / question.asked → notify
//   session.status                                                   → noop
//     (overloaded; would race with session.idle end-of-turn)
//   question.replied / question.rejected / permission.replied / message.updated
//                                                                    → dismiss
//     (explicit resume allowlist; the ONLY events that clear a halt)
//   everything else (message.part.updated, tool.*, tui.*, session.updated, ...)
//                                                                    → noop
//     (sticky: mid-wait noise must not disarm Question/permission waits)
//
// Free-form string match on `type` keeps routing resilient to events
// outside the v1 SDK union. No "any sessionID → dismiss" default.
export function dispatchEvent(
  type: string,
  props: Record<string, unknown>,
  titleBase: string,
): Action {
  const sessionID =
    typeof props.sessionID === "string" ? props.sessionID : undefined

  switch (type) {
    case "session.idle":
      return {
        kind: "notify",
        urgency: "normal",
        title: titleBase,
        body: "Session idle — ready for input",
        tag: "robot",
        sessionID,
      }
    case "session.error":
      return {
        kind: "notify",
        urgency: "critical",
        title: titleBase,
        body: "Session error",
        tag: "warning",
        sessionID,
      }
    case "permission.asked": {
      // Body resolution: v1 `title` (descriptive), then v2 `permission`
      // (coarse: "bash", "edit"), then generic.
      const titleProp = props.title
      const permission = props.permission
      const detail =
        (typeof titleProp === "string" && titleProp.trim()) ||
        (typeof permission === "string" && permission.trim())
      const body = detail
        ? `Permission requested: ${detail}`
        : "Permission requested"
      return {
        kind: "notify",
        urgency: "critical",
        title: titleBase,
        body,
        tag: "lock",
        sessionID,
      }
    }
    case "question.asked": {
      const questions = props.questions as
        | Array<{ header?: unknown }>
        | undefined
      const header = questions?.[0]?.header
      const body =
        typeof header === "string" && header.trim()
          ? `Question: ${header.trim()}`
          : "Question awaiting answer"
      return {
        kind: "notify",
        urgency: "critical",
        title: titleBase,
        body,
        tag: "question",
        sessionID,
      }
    }
    case "session.status":
      return { kind: "noop" }
    case "question.replied":
    case "question.rejected":
    case "permission.replied":
    case "message.updated":
      if (sessionID) return { kind: "dismiss", sessionID }
      return { kind: "noop" }
    default:
      return { kind: "noop" }
  }
}

export type NtfyConfig = {
  server: string // already trimmed of trailing slashes by the caller
  topic?: string
  token?: string
}

// pingNtfy — POST `body` to <server>/<topic>, with `Title` and optional
// `Tags` headers. No-op when `topic` is empty/undefined. 5s timeout. Errors
// swallowed; this is best-effort and must never crash the plugin runtime.
//
// Tests inject a stub global `fetch` to assert URL, method, headers, and
// the no-op-when-topic-unset contract.
export async function pingNtfy(
  config: NtfyConfig,
  title: string,
  body: string,
  tags?: string,
): Promise<void> {
  if (!config.topic) return
  const headers: Record<string, string> = {
    Title: title,
    "Content-Type": "text/plain; charset=utf-8",
  }
  if (tags) headers.Tags = tags
  if (config.token) headers.Authorization = `Bearer ${config.token}`
  try {
    // encodeURIComponent is purely defensive — ntfy topics are restricted
    // to [A-Za-z0-9_-] per the spec, but if someone ever sets the env to a
    // malformed value we still produce a syntactically valid URL.
    const url = `${config.server}/${encodeURIComponent(config.topic)}`
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

export type DismissTracker = {
  // tryAdd — append id to sessionID's list iff id is finite. Non-finite ids
  // (e.g. NaN from a failed parseInt of empty `notify-send -p` stdout) are
  // silently dropped, which matches the existing graceful-degradation
  // behavior when notify-send is missing.
  tryAdd(sessionID: string, id: number): void
  // dismissAll — invoke the injected `dismiss` once per tracked id and
  // forget the session entirely. `delete` runs before the awaits so a slow
  // dismiss can't be re-entered with the same ids.
  dismissAll(sessionID: string): Promise<void>
  // size / count — testing affordances.
  size(): number
  count(sessionID: string): number
}

export function makeDismissTracker(
  dismiss: (id: number) => Promise<void> | void,
): DismissTracker {
  const m = new Map<string, number[]>()
  return {
    tryAdd(sessionID, id) {
      if (!Number.isFinite(id)) return
      const arr = m.get(sessionID) ?? []
      arr.push(id)
      m.set(sessionID, arr)
    },
    async dismissAll(sessionID) {
      const ids = m.get(sessionID)
      if (!ids || ids.length === 0) return
      m.delete(sessionID)
      // Wrap each call so a thrown / rejected dismiss for one id can't
      // poison the rest. Mirrors the `.nothrow().catch(() => {})` chain
      // the entrypoint applies to its `$`-driven dismiss.
      await Promise.all(
        ids.map(async (id) => {
          try {
            await dismiss(id)
          } catch {
            // best-effort: stale ids and dbus errors are harmless
          }
        }),
      )
    },
    size() {
      return m.size
    },
    count(sessionID) {
      return m.get(sessionID)?.length ?? 0
    },
  }
}

// tmuxSlug — make a tmux session name safe to use as a marker filename under
// ~/.local/state/opencode/paused/. `tmux rename-session` accepts arbitrary
// strings, including `/` and `..`, so an unsanitized name could escape the
// paused/ dir or create nested paths. Collapse anything outside [A-Za-z0-9_-]
// to `_`; conventional session names ([A-Za-z0-9_-]) pass through unchanged.
export function tmuxSlug(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_")
}
