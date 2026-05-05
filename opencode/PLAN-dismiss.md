# PLAN-dismiss: auto-dismiss mako toasts when the user responds

Augment the existing opencode notify plugin so that every mako toast it
raises is tracked by mako notification id, and is automatically
dismissed (`makoctl dismiss -n <id>`) when any non-halting event for the
same session arrives — i.e. when the user / agent has demonstrably
resumed work and the alert is no longer needed.

ntfy phone alerts are intentionally left untouched: phones don't
reliably know the user has returned to the laptop.

## Scope

**Single file changed:** `opencode/.config/opencode/plugins/notify.ts`

No changes to `opencode.json`, `package.json`, `package-lock.json`, the
toggl plugin, mako/hypr/shell config, or any other file. No new
dependencies — `notify-send -p` and `makoctl dismiss` are already
present on the Omarchy install (verified locally:
`notify-send -p` returned `117`, `makoctl dismiss -n 117` cleared it).

## Decisions (captured from chat)

| Decision                       | Choice                                                                                                |
|--------------------------------|-------------------------------------------------------------------------------------------------------|
| Which events auto-dismiss      | All four toast-raising events (`session.idle`, `session.error`, `permission.asked`, `question.asked`) |
| Tracking granularity           | **Per session** — `Map<sessionID, number[]>`, not per event type                                      |
| Dismissal trigger              | **Default switch fallthrough**: any event with a `sessionID` that isn't a halting event               |
| `session.status` handling      | Explicit no-op guard — see rationale below                                                            |
| `todo.updated` / `session.diff`| Not guarded up front; revisit if verification shows a same-instant race with `session.idle`           |
| Per-session isolation          | Yes — responding in one session leaves other sessions' toasts intact                                  |
| ntfy phone alerts              | Untouched (no follow-up "resolved" ping, no priority changes)                                         |

## Design

### Per-session id list (plugin-closure scope)

```ts
// sessionID → mako notification ids currently on screen for that session.
// Cleared wholesale on the first non-halting event for the session.
const notificationIDs = new Map<string, number[]>()
```

Map lives inside the plugin closure (not module level) so its lifetime
is bound to the plugin instance and `$` is in scope for the helpers.

### `notify` wrapper — capture id with `-p`, append to list

```ts
const notify = async (
  urgency: "low" | "normal" | "critical",
  title: string,
  body: string,
  tags?: string,
  sessionID?: string, // NEW: when set, captured mako id is appended for this session
) => {
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
```

- `-p` makes `notify-send` print the assigned notification id.
- `.text()` auto-calls `.quiet()` — small UX bonus: the printed id no
  longer leaks into the user's terminal.
- `.nothrow().catch(() => "")` keeps the existing "must never crash the
  plugin" guarantee. Empty/invalid stdout ⇒ `parseInt` is `NaN` ⇒
  nothing tracked for that toast (graceful degradation).
- ntfy continues to fire in parallel exactly as today.

### `dismissAll` helper

```ts
const dismissAll = async (sessionID: string) => {
  const ids = notificationIDs.get(sessionID)
  if (!ids || ids.length === 0) return
  notificationIDs.delete(sessionID) // delete first so a slow makoctl can't double-dismiss
  await Promise.all(
    ids.map((id) =>
      $`makoctl dismiss -n ${id}`.nothrow().quiet().catch(() => {}),
    ),
  )
}
```

`makoctl dismiss -n` against an already-expired or already-dismissed id
is a harmless no-op, so stale entries in the array are not a concern.
Wrapped in `try/catch`-equivalent (`.nothrow().catch`) so a missing
`makoctl` or dbus failure cannot crash the plugin.

### Switch refactor

The four halting cases keep their existing per-event body / urgency /
tag, but each gains a `p.sessionID` argument to `notify`. One no-op
guard for `session.status` and a `default` branch for everything else:

```ts
switch (e.type) {
  case "session.idle":
    await notify("normal", "OpenCode",
                 "Session idle — ready for input", "robot", p.sessionID)
    break
  case "session.error":
    await notify("critical", "OpenCode",
                 "Session error", "warning", p.sessionID)
    break
  case "permission.asked": {
    // ...existing v1/v2 body resolution unchanged...
    await notify("critical", "OpenCode", body, "lock", p.sessionID)
    break
  }
  case "question.asked": {
    // ...existing header-based body resolution unchanged...
    await notify("critical", "OpenCode", body, "question", p.sessionID)
    break
  }
  case "session.status":
    // Overloaded event: fires for status=idle, status=busy, status=retry.
    // Treat as a no-op so we don't immediately dismiss the toast we just
    // raised on session.idle (these two events fire near-simultaneously).
    // The next "real" event (message.updated, tool.execute.before, etc.)
    // will dismiss within milliseconds anyway.
    break
  default:
    // Halting events handled explicitly above; anything else for a known
    // session means the agent / user is moving again ⇒ clear the toasts.
    if (p.sessionID) await dismissAll(p.sessionID)
}
```

### Why the `session.status` guard

opencode emits both `session.status` (with `status.type === "idle"`)
**and** `session.idle` when a turn ends. Both carry a `sessionID`.
Without an explicit no-op for `session.status`, if `session.idle`
arrives first we'd add the mako id to the map, then `session.status
idle` falls through to `default` and immediately dismisses the toast we
just raised. The SDK doesn't publicly guarantee an emission order, so
we make `session.status` an explicit no-op. Total cost: one extra
`break;`.

`todo.updated` and `session.diff` *might* fire concurrently with
`session.idle` at end-of-turn with the same hazard. They are not
guarded up front; verification step 3 below explicitly watches for
this and the guard can be widened to
`case "todo.updated": case "session.diff": break;` if needed.

### What gets dismissed by `default` in practice

Anything with a `sessionID` that isn't a halting event or
`session.status`. High-frequency hits:

| Event                       | When it fires                         |
|-----------------------------|---------------------------------------|
| `message.updated`           | New user message / new assistant turn |
| `message.part.updated`      | Streaming during a turn               |
| `tool.execute.before/after` | Each tool call                        |
| `permission.replied`        | User answered a permission            |
| `question.replied/rejected` | User answered a question              |

All of these legitimately mean "the session is alive again", so
dismissing toasts for that session on any of them is correct. Events
with no `sessionID` (`installation.updated`, `server.connected`,
`file.watcher.updated`, etc.) are silently ignored by the
`if (p.sessionID)` guard.

### Docstring update

Top-of-file docstring gains a paragraph documenting:

- Mako toast ids are captured via `notify-send -p` and stored in a
  per-session in-memory list.
- The list is cleared wholesale on the first non-halting event for
  that session (default switch fallthrough).
- `session.status` is an explicit no-op to avoid an end-of-turn race
  with the `session.idle` toast we just raised.
- This is intentionally session-level rather than per-toast: if you
  have two outstanding alerts for one session, responding to either
  clears both — by then you're engaged with that session anyway.
- `makoctl dismiss` is best-effort (stale ids are no-ops, errors
  swallowed); ntfy is untouched.

## Edge cases & how they're handled

| Edge case                                           | Behaviour                                                                                                                                     |
|-----------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
| `notify-send` missing or dbus down                  | `.nothrow().text().catch("")` ⇒ empty stdout ⇒ `parseInt` is `NaN` ⇒ nothing tracked ⇒ later dismiss is a no-op for that session.             |
| Toast already expired / user-dismissed before reply | `makoctl dismiss -n <stale_id>` is a harmless no-op; the array is cleared anyway.                                                              |
| Two permissions queued at once for one session      | First reply (or any other non-halting event) dismisses **both** toasts. Per the simplification this is intentional — you're engaged anyway.    |
| Idle toast + permission toast both showing          | Same: first non-halting event clears the lot.                                                                                                  |
| Same session goes idle, busy, idle in quick succession | `busy`'s message events dismiss the previous idle toast; second `idle` adds a fresh one — correct behaviour.                                |
| `session.status` fires alongside `session.idle`     | Explicitly guarded: no dismissal triggered.                                                                                                    |
| `todo.updated` / `session.diff` fire near-idle      | Not guarded up front. Verification step 3 watches for premature dismissal; widen guard if observed.                                            |
| `makoctl` not installed                             | `.nothrow().catch()` swallows the error; toasts simply won't auto-dismiss.                                                                     |
| Long-lived plugin, many sessions over time          | `notificationIDs.delete(sessionID)` on every `dismissAll` keeps the map bounded to currently-active sessions with outstanding alerts.          |

## What this plan does *not* touch

- ntfy fan-out (urgency, tags, `pingNtfy`, env-var contract — all unchanged).
- `notify-send` urgency / app-name / tag semantics for any existing case.
- `permission.replied` field-name compatibility (`requestID` vs
  `permissionID`) — no longer needed; we don't read the request id at
  dismiss time.
- Any other plugin (`toggl-time.ts`) or any `~/.config/mako/`,
  `~/.config/hypr/`, or shell config.
- `opencode.json`, `package.json`, `package-lock.json`.

## Verification

1. **No regression when ntfy unset.** Plugin starts and behaves exactly
   as today; toasts still raise on idle / error / permission /
   question. ntfy fan-out is silent if `OPENCODE_IDLE_NTFY_TOPIC` is
   unset.
2. **Type check / parse.** `notify.ts` still type-checks against
   `@opencode-ai/plugin@1.4.7` (we only add cases to the runtime-string
   switch).
3. **No premature dismissal at end-of-turn.** Finish a turn ⇒ idle
   toast appears ⇒ toast must remain visible until the user does
   something. Watch `makoctl list` for several seconds. If it
   disappears immediately, expand the guard to include
   `case "todo.updated": case "session.diff": break;`.
4. **Idle dismiss.** Idle toast on screen ⇒ submit a new prompt ⇒
   toast disappears. `makoctl list` confirms.
5. **Permission dismiss.** Trigger an unapproved bash command ⇒
   permission toast appears ⇒ approve / deny in opencode ⇒ toast
   disappears.
6. **Question dismiss.** Trigger a `question.asked` flow ⇒ toast
   appears ⇒ reply or reject ⇒ toast disappears.
7. **Multi-toast collapse.** Have idle + permission toast on screen
   for one session ⇒ respond to permission ⇒ both toasts disappear
   (per the "session-level" intent).
8. **Per-session isolation.** Run two opencode sessions in two
   terminals. Both go idle. Respond in only session A ⇒ session A's
   toast disappears, session B's stays.
9. **Stale-id tolerance.** Manually `makoctl dismiss --all` while a
   tracked toast exists, then submit a prompt ⇒ no error in opencode
   logs, plugin keeps working for subsequent events.
10. **Missing `makoctl` simulation.** Temporarily rename `makoctl` (or
    run with a pruned `PATH`) ⇒ toasts still appear, dismiss attempts
    fail silently, plugin keeps running.
