import type { Plugin } from "@opencode-ai/plugin"
import { promises as fs } from "node:fs"
import path from "node:path"

/**
 * Toggl time-tracking helper for opencode.
 *
 * Appends start/pause events to `<worktree>/.toggl-time` (JSONL) every time
 * the agent transitions between busy and waiting, but only when a complete
 * `<worktree>/.toggl` context (client_name, project_id, project_name, task)
 * is configured by `toggl-set`.
 *
 * Trigger map:
 *
 *   start  ← chat.message                          (new user prompt)
 *   start  ← permission.replied (reply ≠ reject)   (agent resumes after permission grant)
 *   start  ← question.replied                      (agent resumes after question answer)
 *   pause  ← session.idle                          (turn finished)
 *   pause  ← permission.updated | permission.asked (waiting for permission)
 *   pause  ← question.asked                        (waiting for question answer)
 *   pause  ← session.error                         (error halted the agent)
 *
 * Note on event names + shapes: the opencode runtime is mid-migration from
 * v1 to v2 SDK event shapes. Empirically (May 2026) the runtime emits the
 * v2 names `permission.asked` and `question.asked` for the prompt edge, and
 * `permission.replied` / `question.replied` with v2 property shapes
 * (`requestID` + `reply` instead of v1's `permissionID` + `response`). The
 * type definitions imported via `@opencode-ai/plugin@1.4.7` still describe
 * v1, so the `event` hook below is intentionally untyped inside the switch
 * and looks for fields under both v1 and v2 keys. v1-shape events are still
 * accepted in case the runtime regresses or a different opencode build
 * delivers them.
 *
 * Gating: every event re-reads `.toggl` so that a `toggl-set` mid-session
 * takes effect immediately. If the file is missing, malformed, or any of
 * `client_name` / `project_id` / `project_name` / `task` is empty/null,
 * nothing is written.
 *
 * Robustness: every filesystem operation is try/caught — the plugin is
 * best-effort and must never bring the runtime down (mirrors the
 * `.nothrow()` philosophy of ./notify.ts).
 */

type TogglContext = {
  project_id: number
  project_name: string
  client_name: string
  task: string
}

const readToggl = async (togglPath: string): Promise<TogglContext | null> => {
  let raw: string
  try {
    raw = await fs.readFile(togglPath, "utf8")
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object") return null
  const o = parsed as Record<string, unknown>
  const { project_id, project_name, client_name, task } = o
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

export const TogglTimePlugin: Plugin = async ({ worktree }) => {
  const togglPath = path.join(worktree, ".toggl")
  const logPath = path.join(worktree, ".toggl-time")

  const log = async (
    eventKind: "start" | "pause",
    trigger: string,
    sessionID: string | undefined,
    details?: Record<string, unknown>,
  ) => {
    const ctx = await readToggl(togglPath)
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
    if (details) {
      const trimmed = Object.fromEntries(
        Object.entries(details).filter(([, v]) => v !== undefined),
      )
      if (Object.keys(trimmed).length > 0) entry.details = trimmed
    }
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
      // The runtime currently emits v2-shape events with property names
      // (`requestID`, `reply`, `permission`, `patterns`) that the v1 type
      // definitions don't describe. Falling back through both shapes lets
      // the plugin keep working across opencode versions; missing fields
      // come through as `undefined` and are stripped in `log()`.
      const e = event as unknown as { type: string; properties?: any }
      const p = e.properties ?? {}
      switch (e.type) {
        case "session.idle":
          await log("pause", e.type, p.sessionID)
          break
        case "permission.updated": // v1
        case "permission.asked": // v2
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
          await log("pause", e.type, p.sessionID)
          break
        case "question.replied": {
          // properties.answers is `Array<Array<string>>` (one inner array per
          // question, each a list of selected labels). Surface the first
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
        case "session.error":
          await log("pause", e.type, p.sessionID, {
            error_name: p.error?.name,
          })
          break
      }
    },
  }
}
