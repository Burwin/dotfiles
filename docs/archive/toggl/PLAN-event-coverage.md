# Plan: Expand `toggl-time.ts` to handle every documented event

> **Status:** implemented; archived 2026-05-06.
>
> Implementation lives in:
> - `opencode/.config/opencode/plugins/toggl-time.ts` — full switch coverage
>   (the four new `start` cases land at lines 355–386; the explicit no-op
>   groups at lines 393–426; the forward-compat `default:` arm at 428–435)
>
> Preserved for decision history. Cross-references in this document are
> historical.

Make `opencode/.config/opencode/plugins/toggl-time.ts` exhaustive against the
event list at <https://opencode.ai/docs/plugins/#events>: every documented
event gets an explicit case in the switch, classified as `start`, `pause`,
or no-op (with a one-line rationale). High-frequency stream events stay
no-ops so the `toggl_heartbeats` table keeps its human-event granularity.
Existing v1/v2 SDK property-shape compatibility is preserved.

Only one file is touched. No schema change, no migration, no `toggl-group`
change.

## 1. Event classification

### Existing behavior preserved

| Trigger                            | Mapping | Notes                                           |
| ---------------------------------- | ------- | ----------------------------------------------- |
| `chat.message` (top-level hook)    | `start` | New user prompt.                                |
| `permission.replied` (non-reject)  | `start` | Agent resumes after grant.                      |
| `question.replied`                 | `start` | Agent resumes after answer.                     |
| `session.idle`                     | `pause` | Turn finished.                                  |
| `session.error`                    | `pause` | Error halted the agent.                         |
| `permission.asked`                 | `pause` | Waiting for permission.                         |
| `question.asked`                   | `pause` | Waiting for question answer.                    |
| `session.status`                   | no-op   | Overloaded; races with `session.idle`.          |

### New `start` cases

| Event              | Rationale                                                        | `details` payload                                                  |
| ------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `command.executed` | Slash command run — user-driven activity.                        | `command` name (best-effort `typeof` guard).                       |
| `file.edited`      | File edited (agent or user). Activity signal.                    | `file` path (best-effort).                                         |
| `session.compacted`| Compaction finished, agent auto-continues. Work resuming.        | None — properties shape varies; rely on event type alone.          |
| `todo.updated`     | Agent updated todos — discrete activity. Extra signal in cases   | None — count varies; type alone is enough for time-tracking.       |
|                    | where the session has no `chat.message` start (rare).            |                                                                    |

### Explicit no-op cases (with brief in-code rationale)

Grouped in code by category for greppability.

**High-frequency stream events:**

- `message.part.updated` — fires per streaming token.
- `message.part.removed` — companion to `part.updated`; same frequency class.
- `message.updated` — per-message stream event; redundant with `chat.message` start.
- `message.removed` — UI/state change, not a busy/wait transition.

**Session lifecycle / not a state transition:**

- `session.created` — first `chat.message` is the actual work-start signal.
- `session.deleted` — terminal; no work happens after.
- `session.updated` — too generic; covered by more-specific cases.
- `session.diff` — informational.

**No sessionID / unrelated to user work:**

- `installation.updated` — opencode self-update.
- `server.connected` — lifecycle.
- `lsp.client.diagnostics` — infrastructure.
- `lsp.updated` — infrastructure.
- `file.watcher.updated` — filesystem noise, not user-driven.

**TUI noise:**

- `tui.prompt.append` — fires per keystroke.
- `tui.command.execute` — too generic; `command.executed` covers the meaningful case.
- `tui.toast.show` — UI display only.

## 2. Code changes — `opencode/.config/opencode/plugins/toggl-time.ts`

### Switch statement (currently lines 273–326)

- **Keep** the 6 existing arms unchanged.
- **Add** 4 new `start` cases with `details` populated via `typeof` guards
  (mirrors the existing defensive shape-handling for `permission.asked`).
  Each new arm reads `event.properties` permissively under both v1 and v2
  property names, falling back to `undefined` (which `trimDetails` already
  prunes).
- **Add** the no-op cases listed above. Each gets a one-line `//` comment
  explaining why; group them under section comments
  (`// --- High-frequency stream events (skipped) ---`, etc.) so the
  rationale is searchable.
- **Keep** a runtime `default:` no-op as a safety net for future docs
  additions, with a comment pointing readers to the events docs URL so an
  unhandled type prompts a re-review rather than a silent fall-through.

### Header docstring (currently lines 19–27)

The trigger map block currently lists 7 events. Update to:

- Replace the 7-line table with the expanded 11-event start/pause map.
- Add one paragraph explaining the no-op category (high-freq streams,
  no-sessionID lifecycle events, TUI noise) so future readers see why
  those aren't logged.
- Keep the v1/v2 property-shape compatibility note unchanged.

## 3. Out of scope

- **`notify.ts`** — not touched. Its `default:` arm already dismisses on
  *any* session-bearing event, so all new event types are implicitly
  covered there.
- **No new diagnostic-log plugin.** Decision was option 1 (toggl
  heartbeats only), not option 3 (both).
- **Tool/shell hooks** (`tool.execute.before`, `tool.execute.after`,
  `shell.env`) — these are top-level hooks, not events delivered through
  the `event:` callback. The docs page groups them under "Events" but
  they have different signatures. Out of scope unless explicitly added.
- **`question.rejected`** — appears in the v2 SDK Event union but not in
  the docs events list. Will hit the `default:` runtime safety arm.
  Trivial to add if/when we want explicit handling.

## 4. Risks

- **`details` payload shapes are guesses.** v1 type definitions don't
  describe runtime properties for `command.executed`, `file.edited`,
  `session.compacted`, or `todo.updated`. Mitigation: every field read is
  guarded with `typeof`, missing fields produce `undefined`, `trimDetails`
  prunes those, and the existing `try/catch` around the insert swallows
  any error. Worst case: the row lands with `details = NULL`. No crash.
- **Heartbeat row volume bump.** Four new `start` triggers add rows, but
  the new ones are O(human actions), not O(tokens). The
  PLAN-heartbeats.md estimate of 1k–10k rows/day under heavy use is
  unaffected at the order-of-magnitude level. `toggl-group --since`
  remains the relief valve.
- **`toggl-group` semantics unchanged.** Each new `start` is another
  "still working" signal; existing `groupEvents` logic already coalesces
  consecutive starts into one continuous span. No CLI change needed.
- **Docs drift.** If opencode adds a new event type upstream, the runtime
  delivers it and our `default:` arm silently no-ops. Mitigation: the
  comment on the `default:` arm tells future readers to re-review the
  events docs when something new shows up in `toggl_heartbeats` queries
  with an unfamiliar `trigger` value (which won't happen for unhandled
  events, but the comment exists for the case where someone *does* want
  to add coverage).

## 5. Locked-in decisions (from Q&A)

- **Where to log:** Toggl heartbeats only. No separate diagnostic log
  plugin, no expansion of `notify.ts`.
- **Frequency tradeoff:** Skip high-frequency stream events
  (`message.part.*`, `message.updated`, `message.removed`,
  `tui.prompt.append`). Heartbeats stay at human-event granularity.
- **Coverage style:** Every documented event gets an explicit case
  (start, pause, or commented no-op). No bare default catch-all for
  documented events; `default:` exists only as a forward-compat safety net.

## Files changed (final list)

Modified:

- `opencode/.config/opencode/plugins/toggl-time.ts` — expanded switch with
  new `start` cases, explicit no-op cases, updated header docstring.

Added: none.

Removed: none.
