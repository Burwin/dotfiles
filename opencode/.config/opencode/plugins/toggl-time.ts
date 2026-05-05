import type { Plugin } from "@opencode-ai/plugin"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * Toggl time-tracking helper for opencode.
 *
 * Inserts start/pause heartbeat rows into the `toggl_heartbeats` table of
 * the central state DB at `~/.local/state/toggl/state.db` every time the
 * agent transitions between busy and waiting, but only when a complete
 * Toggl context (client_name, project_id, project_name, task) is configured
 * for the realpath of the worktree in `toggl_repo_state`. Set the
 * `toggl_repo_state` row via `toggl-set` (or seed it from legacy
 * `<repo>/.toggl` files via `toggl-migrate`).
 *
 * Trigger map — all signals come from the documented `event` hook
 * (https://opencode.ai/docs/plugins#events) plus the `chat.message` hook.
 * Coverage goal: every documented event has an explicit case in the
 * switch — start, pause, or no-op with rationale — so docs drift surfaces
 * quickly and intent is greppable.
 *
 *   start  ← chat.message                          (new user prompt)
 *   start  ← permission.replied (response ≠ reject) (agent resumes after grant)
 *   start  ← question.replied                       (agent resumes after answer)
 *   start  ← command.executed                       (slash command run)
 *   start  ← file.edited                            (file edited; activity signal)
 *   start  ← session.compacted                      (compaction done; agent auto-continues)
 *   start  ← todo.updated                           (agent updated todos; activity signal)
 *   pause  ← session.idle                           (turn finished)
 *   pause  ← session.error                          (error halted the agent)
 *   pause  ← permission.asked                       (waiting for permission)
 *   pause  ← question.asked                         (waiting for question answer)
 *
 * No-op events (explicit cases in the switch with one-line rationale):
 *
 *   - High-frequency stream events (would dominate the table with per-token
 *     rows and break start/pause semantics): `message.part.updated`,
 *     `message.part.removed`, `message.updated`, `message.removed`,
 *     `tui.prompt.append`.
 *   - Session lifecycle/non-transitions (covered by more-specific cases or
 *     informational only): `session.created`, `session.deleted`,
 *     `session.updated`, `session.diff`, `session.status` (overloaded;
 *     races with `session.idle`).
 *   - No-sessionID / unrelated to user work: `installation.updated`,
 *     `server.connected`, `lsp.client.diagnostics`, `lsp.updated`,
 *     `file.watcher.updated`.
 *   - TUI noise: `tui.command.execute`, `tui.toast.show`.
 *
 * The `default:` arm stays as a forward-compat safety net — when opencode
 * adds a new event type upstream, that event silently no-ops here and
 * the comment on the default arm tells future readers to classify it.
 *
 * Property shape note: the v1 SDK type definitions imported via
 * `@opencode-ai/plugin@1.4.7` predate the v2 event names that the runtime
 * actually delivers. The switch below casts `event` to a permissive shape
 * and reads fields under both v1 (`type`/`pattern`/`title`/`permissionID`/
 * `response`) and v2 (`permission`/`patterns`/`requestID`/`reply`) keys, so
 * both shapes are accepted.
 *
 * Gating: every log call re-queries `toggl_repo_state` so that a `toggl-set`
 * mid-session takes effect immediately. If the row is missing, or any of
 * `client_name` / `project_id` / `project_name` / `task` is empty/null,
 * nothing is written.
 *
 * Storage: previously this plugin appended JSONL to `<worktree>/.toggl-time`.
 * That file format is now superseded by the `toggl_heartbeats` table; the
 * one-shot `toggl-time-migrate` imported any pre-existing JSONL into the
 * DB. See toggl/PLAN-heartbeats.md.
 *
 * Bootstrap: on first open we ensure both tables exist and that
 * `journal_mode=WAL` is enabled. The DDL below MUST stay in sync with
 * toggl/.local/bin/toggl-state.lib.sh — they are both authoritative bootstrap
 * paths (this one for Bun-only hosts, the lib for shell consumers).
 *
 * Runtime: opencode is shipped as a Bun-compiled binary, so plugins import
 * `bun:sqlite` directly. We dynamic-import it inside a try/catch so a
 * Node-runtime fallback degrades to silent no-op rather than crashing the
 * plugin host.
 *
 * Robustness: every SQL operation is try/caught — the plugin is best-effort
 * and must never bring the runtime down (mirrors the `.nothrow()` philosophy
 * of ./notify.ts).
 */

type TogglContext = {
  project_id: number
  project_name: string
  client_name: string
  task: string
}

type StateRow = {
  project_id: number
  project_name: string
  client_name: string | null
  task: string | null
}

type SqliteStatement = {
  get: (...params: unknown[]) => unknown
  run: (...params: unknown[]) => unknown
}

type SqliteDb = {
  query: (sql: string) => SqliteStatement
  prepare: (sql: string) => SqliteStatement
  exec: (sql: string) => void
  close?: () => void
}

// Path can be overridden via TOGGL_STATE_DB env var (matching the
// convention used by toggl-state.lib.sh and the toggl-group CLI). Default
// is ~/.local/state/toggl/state.db.
const STATE_DB =
  process.env.TOGGL_STATE_DB ||
  path.join(os.homedir(), ".local/state/toggl/state.db")

// Inline DDL — KEEP IN SYNC with toggl/.local/bin/toggl-state.lib.sh.
const BOOTSTRAP_SQL = `
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS toggl_repo_state (
    worktree_path TEXT PRIMARY KEY,
    project_id    INTEGER NOT NULL,
    project_name  TEXT    NOT NULL,
    client_name   TEXT,
    task          TEXT,
    updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS toggl_heartbeats (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ts            TEXT    NOT NULL,
    event         TEXT    NOT NULL CHECK (event IN ('start','pause')),
    trigger       TEXT    NOT NULL,
    session_id    TEXT,
    worktree_path TEXT    NOT NULL,
    client_name   TEXT    NOT NULL,
    project_id    INTEGER NOT NULL,
    project_name  TEXT    NOT NULL,
    task          TEXT    NOT NULL,
    details       TEXT
);
CREATE INDEX IF NOT EXISTS idx_heartbeats_worktree_ts
    ON toggl_heartbeats(worktree_path, ts);
CREATE INDEX IF NOT EXISTS idx_heartbeats_ts
    ON toggl_heartbeats(ts);
`

const INSERT_SQL = `INSERT INTO toggl_heartbeats
  (ts, event, trigger, session_id, worktree_path,
   client_name, project_id, project_name, task, details)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

const SELECT_STATE_SQL =
  "SELECT project_id, project_name, client_name, task FROM toggl_repo_state WHERE worktree_path = ?"

type DbBundle = {
  db: SqliteDb
  insertStmt: SqliteStatement
  selectStmt: SqliteStatement
}

let dbPromise: Promise<DbBundle | null> | null = null

const openDb = async (): Promise<DbBundle | null> => {
  // Cache one Database handle + prepared statements per plugin lifetime.
  // bun:sqlite Database is sync; preparing is microseconds. Re-opening on
  // every event would dominate per-event cost.
  if (dbPromise) return dbPromise
  dbPromise = (async () => {
    try {
      // Dynamic import so a non-Bun host (tests, future Node-based runtime)
      // doesn't break the entire plugin file at parse time.
      const mod = (await import("bun:sqlite")) as {
        Database: new (
          path: string,
          options?: { readonly?: boolean; create?: boolean },
        ) => SqliteDb
      }
      // Ensure parent directory exists so a fresh machine bootstraps
      // cleanly on the very first event (toggl-set may not have run yet).
      try {
        await fs.mkdir(path.dirname(STATE_DB), { recursive: true })
      } catch {
        // best-effort: continue and let Database open fail if it must
      }
      const db = new mod.Database(STATE_DB, { create: true })
      // Bootstrap schema + WAL. Idempotent.
      try {
        db.exec(BOOTSTRAP_SQL)
      } catch {
        // If bootstrap fails (extremely unlikely on a healthy SQLite),
        // leave dbPromise resolving to null so the plugin no-ops.
        return null
      }
      return {
        db,
        insertStmt: db.prepare(INSERT_SQL),
        selectStmt: db.prepare(SELECT_STATE_SQL),
      }
    } catch {
      return null
    }
  })()
  return dbPromise
}

const readToggl = async (
  canonicalWorktree: string,
): Promise<TogglContext | null> => {
  const bundle = await openDb()
  if (!bundle) return null
  let row: StateRow | undefined
  try {
    row = bundle.selectStmt.get(canonicalWorktree) as StateRow | undefined
  } catch {
    return null
  }
  if (!row) return null
  const { project_id, project_name, client_name, task } = row
  if (
    typeof project_id !== "number" ||
    typeof project_name !== "string" ||
    project_name === "" ||
    typeof client_name !== "string" ||
    client_name === "" ||
    typeof task !== "string" ||
    task === ""
  ) {
    return null
  }
  return { project_id, project_name, client_name, task }
}

const trimDetails = (details?: Record<string, unknown>) => {
  if (!details) return undefined
  const trimmed = Object.fromEntries(
    Object.entries(details).filter(([, v]) => v !== undefined),
  )
  return Object.keys(trimmed).length > 0 ? trimmed : undefined
}

export const TogglTimePlugin: Plugin = async ({ worktree }) => {
  // Resolve worktree → canonical absolute path once. This must agree with
  // the path that toggl-set writes (which is realpath of git-toplevel).
  // realpath fails on non-existent paths; if that ever happens here,
  // fall back to the literal worktree string so we still try a lookup.
  let canonicalWorktree: string
  try {
    canonicalWorktree = await fs.realpath(worktree)
  } catch {
    canonicalWorktree = worktree
  }

  const log = async (
    eventKind: "start" | "pause",
    trigger: string,
    sessionID: string | undefined,
    details?: Record<string, unknown>,
  ) => {
    const ctx = await readToggl(canonicalWorktree)
    if (!ctx) return
    const bundle = await openDb()
    if (!bundle) return
    const ts = new Date().toISOString()
    const trimmed = trimDetails(details)
    const detailsJson = trimmed ? JSON.stringify(trimmed) : null
    try {
      bundle.insertStmt.run(
        ts,
        eventKind,
        trigger,
        sessionID ?? null,
        canonicalWorktree,
        ctx.client_name,
        ctx.project_id,
        ctx.project_name,
        ctx.task,
        detailsJson,
      )
    } catch {
      // best-effort: swallow SQL errors (DB locked, schema drift, etc.)
    }
  }

  return {
    "chat.message": async (input) => {
      await log("start", "chat.message", input.sessionID, {
        agent: input.agent,
        model: input.model,
      })
    },
    event: async ({ event }) => {
      // v1 type definitions don't describe v2 event names like
      // `permission.asked` and `question.asked`, but the runtime delivers
      // them per the docs. Cast once and dispatch on a free-form string.
      const e = event as unknown as { type: string; properties?: any }
      const p = e.properties ?? {}
      switch (e.type) {
        // --- Pause triggers (agent halted, waiting for input) ---
        case "session.idle":
          await log("pause", e.type, p.sessionID)
          break
        case "session.error":
          await log("pause", e.type, p.sessionID, {
            error_name: p.error?.name,
          })
          break
        case "permission.asked":
          await log("pause", e.type, p.sessionID, {
            permission_id: p.id,
            // v1: `type`, v2: `permission`
            permission_type: p.type ?? p.permission,
            // v1 only
            title: p.title,
            // v2: `patterns: string[]`; v1: `pattern: string | string[]`
            patterns:
              p.patterns ??
              (typeof p.pattern === "string"
                ? [p.pattern]
                : Array.isArray(p.pattern)
                  ? p.pattern
                  : undefined),
          })
          break
        case "question.asked":
          await log("pause", e.type, p.sessionID, {
            header: p.questions?.[0]?.header,
          })
          break

        // --- Start triggers (agent / user resumed work) ---
        case "permission.replied": {
          // v1: `{ permissionID, response }`, v2: `{ requestID, reply }`
          const reply = p.reply ?? p.response
          if (reply === "reject") break
          await log("start", e.type, p.sessionID, {
            permission_id: p.requestID ?? p.permissionID,
            response: reply,
          })
          break
        }
        case "question.replied": {
          // properties.answers is `Array<Array<string>>`. Surface the first
          // selection of the first question for diagnostics; nothing if absent.
          const reply = p.answers?.[0]?.[0]
          await log(
            "start",
            e.type,
            p.sessionID,
            reply !== undefined ? { reply } : undefined,
          )
          break
        }
        case "command.executed":
          // Slash command run — user-driven activity. v2 properties:
          // `{ name, sessionID, arguments, messageID }`. Surface command
          // name + (truncated) arguments; both guarded by typeof since v1
          // type defs don't describe this shape.
          await log("start", e.type, p.sessionID, {
            command: typeof p.name === "string" ? p.name : undefined,
            arguments:
              typeof p.arguments === "string" ? p.arguments : undefined,
          })
          break
        case "file.edited":
          // File edited (agent or user). v2 properties: `{ file: string }`
          // — note no sessionID, so heartbeat row will have session_id NULL.
          // Worktree gating still applies via canonicalWorktree → ctx.
          await log("start", e.type, p.sessionID, {
            file: typeof p.file === "string" ? p.file : undefined,
          })
          break
        case "session.compacted":
          // Compaction finished. The agent typically auto-continues, so
          // this is a work-resuming signal. v2 properties: `{ sessionID }`.
          await log("start", e.type, p.sessionID)
          break
        case "todo.updated":
          // Agent updated the todo list — discrete activity. Useful as a
          // backup start signal in sessions that arrive without a
          // chat.message (rare). v2 properties: `{ sessionID, todos }`.
          await log("start", e.type, p.sessionID, {
            todo_count: Array.isArray(p.todos) ? p.todos.length : undefined,
          })
          break

        // --- No-op: high-frequency stream events ---
        // Logging these would flood the heartbeats table with per-token
        // rows and erase the start/pause distinction `toggl-group` relies
        // on. The agent's busy-state is already bracketed by chat.message
        // → session.idle.
        case "message.part.updated": // fires per streaming token
        case "message.part.removed": // companion to part.updated
        case "message.updated": // per-message stream event
        case "message.removed": // UI/state change, not a transition
        case "tui.prompt.append": // fires per keystroke in the TUI prompt
          break

        // --- No-op: session lifecycle / not a transition ---
        // The actual work-start signal is chat.message (covered above);
        // these are bookkeeping or already-covered transitions.
        case "session.created": // first chat.message is the real start
        case "session.deleted": // terminal — no work happens after
        case "session.updated": // too generic; covered by specific cases
        case "session.diff": // informational
        case "session.status": // overloaded; races with session.idle
          break

        // --- No-op: no sessionID / unrelated to user work ---
        // These fire from infrastructure/lifecycle, not user activity.
        // Logging would attribute non-work events to the worktree's toggl
        // context.
        case "installation.updated": // opencode self-update
        case "server.connected": // server lifecycle
        case "lsp.client.diagnostics": // language server output
        case "lsp.updated": // language server state
        case "file.watcher.updated": // filesystem watcher noise
          break

        // --- No-op: TUI noise ---
        // command.executed (above) covers the meaningful slash-command
        // case; the rest are display-only.
        case "tui.command.execute": // too generic vs command.executed
        case "tui.toast.show": // UI display only
          break

        default:
          // Forward-compat safety net. If opencode adds a new event type
          // to https://opencode.ai/docs/plugins#events, it lands here and
          // silently no-ops. Re-classify as start / pause / explicit no-op
          // when that happens. Also catches v2-only events the docs page
          // doesn't list yet (e.g. question.rejected, tui.session.select,
          // mcp.*, vcs.*, pty.*, worktree.*, workspace.*).
          break
      }
    },
  }
}
