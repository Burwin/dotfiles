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
 * (https://opencode.ai/docs/plugins#events) plus the `chat.message` hook:
 *
 *   start  ← chat.message                          (new user prompt)
 *   start  ← permission.replied (response ≠ reject) (agent resumes after grant)
 *   start  ← question.replied                       (agent resumes after answer)
 *   pause  ← session.idle                           (turn finished)
 *   pause  ← session.error                          (error halted the agent)
 *   pause  ← permission.asked                       (waiting for permission)
 *   pause  ← question.asked                         (waiting for question answer)
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
        case "question.asked":
          await log("pause", e.type, p.sessionID, {
            header: p.questions?.[0]?.header,
          })
          break
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
      }
    },
  }
}
