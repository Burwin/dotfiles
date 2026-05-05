import type { Plugin } from "@opencode-ai/plugin"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * Toggl time-tracking helper for opencode.
 *
 * Appends start/pause events to `<worktree>/.toggl-time` (JSONL) every time
 * the agent transitions between busy and waiting, but only when a complete
 * Toggl context (client_name, project_id, project_name, task) is configured
 * for the realpath of the worktree in the central state DB at
 * `~/.local/state/toggl/state.db`. Set the row via `toggl-set` (or seed from
 * the legacy `<repo>/.toggl` files via `toggl-migrate`).
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
 * Gating: every log call re-queries the state DB so that a `toggl-set`
 * mid-session takes effect immediately. If the row is missing, or any of
 * `client_name` / `project_id` / `project_name` / `task` is empty/null,
 * nothing is written.
 *
 * Runtime: opencode is shipped as a Bun-compiled binary, so plugins import
 * `bun:sqlite` directly. We dynamic-import it inside a try/catch so a
 * Node-runtime fallback degrades to silent no-op rather than crashing the
 * plugin host.
 *
 * Robustness: every filesystem and SQL operation is try/caught — the plugin
 * is best-effort and must never bring the runtime down (mirrors the
 * `.nothrow()` philosophy of ./notify.ts).
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

type SqliteQuery = {
  get: (...params: unknown[]) => unknown
}

type SqliteDb = {
  query: (sql: string) => SqliteQuery
  close?: () => void
}

const STATE_DB = path.join(os.homedir(), ".local/state/toggl/state.db")

let dbPromise: Promise<SqliteDb | null> | null = null

const openDb = async (): Promise<SqliteDb | null> => {
  // Cache one Database handle per plugin lifetime. Re-opens on each
  // resolution would dominate the per-event cost; opening once is fine
  // because SQLite readers don't block on writers.
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
      // readonly + create:false: if state.db doesn't exist (fresh machine,
      // never ran toggl-set or toggl-migrate), throw → cache null →
      // plugin silently no-ops, mirroring the legacy "no .toggl" behavior.
      return new mod.Database(STATE_DB, { readonly: true, create: false })
    } catch {
      return null
    }
  })()
  return dbPromise
}

const readToggl = async (
  canonicalWorktree: string,
): Promise<TogglContext | null> => {
  const db = await openDb()
  if (!db) return null
  let row: StateRow | undefined
  try {
    row = db
      .query(
        "SELECT project_id, project_name, client_name, task FROM toggl_repo_state WHERE worktree_path = ?",
      )
      .get(canonicalWorktree) as StateRow | undefined
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
  const logPath = path.join(worktree, ".toggl-time")

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
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      event: eventKind,
      trigger,
      session_id: sessionID,
      client_name: ctx.client_name,
      project_id: ctx.project_id,
      project_name: ctx.project_name,
      task: ctx.task,
    }
    const d = trimDetails(details)
    if (d) entry.details = d
    try {
      await fs.appendFile(logPath, JSON.stringify(entry) + "\n")
    } catch {
      // best-effort: swallow filesystem errors
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
