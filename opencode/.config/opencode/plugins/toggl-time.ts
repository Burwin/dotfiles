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
 * Trigger map (hook origin in parens):
 *
 *   start  ← chat.message                                (chat.message hook)
 *   start  ← permission.replied (reply ≠ reject)         (event bus)
 *   start  ← question.reply                              (tool.execute.after, tool === "question")
 *   pause  ← session.idle                                (event bus)
 *   pause  ← session.error                               (event bus)
 *   pause  ← permission.ask                              (permission.ask hook)
 *   pause  ← question.ask                                (tool.execute.before, tool === "question")
 *
 * Architecture note: opencode's runtime delivers ask-side signals through
 * dedicated *hooks* (`permission.ask`, `tool.execute.before/after`), not
 * via the generic `event` bus. The bus reliably fires `session.idle`,
 * `session.error`, and `permission.replied`; ask-side events
 * (`permission.asked`, `question.asked`) were observed empirically (May
 * 2026) to never reach the bus. See ./notify.ts for the matching split.
 *
 * Permission shape note: the v1 SDK `Permission` payload (typed via
 * `@opencode-ai/plugin@1.4.7`) uses `type`/`pattern`/`title`. A future v2
 * `PermissionRequest` payload uses `permission`/`patterns`/no-title. The
 * `permission.ask` hook below reads either shape. The `permission.replied`
 * event also has v1 (`permissionID`/`response`) vs v2 (`requestID`/`reply`)
 * shapes — observed v2 in the wild — so we accept both.
 *
 * Gating: every log call re-reads `.toggl` so that a `toggl-set` mid-session
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

const trimDetails = (details?: Record<string, unknown>) => {
  if (!details) return undefined
  const trimmed = Object.fromEntries(
    Object.entries(details).filter(([, v]) => v !== undefined),
  )
  return Object.keys(trimmed).length > 0 ? trimmed : undefined
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
    "permission.ask": async (input) => {
      // v1 Permission: { id, type, pattern, sessionID, title, ... }
      // v2 PermissionRequest: { id, permission, patterns, sessionID, ... }
      const i = input as unknown as {
        id?: unknown
        type?: unknown
        permission?: unknown
        title?: unknown
        pattern?: unknown
        patterns?: unknown
        sessionID?: unknown
      }
      const patterns = Array.isArray(i.patterns)
        ? i.patterns
        : typeof i.pattern === "string"
          ? [i.pattern]
          : Array.isArray(i.pattern)
            ? i.pattern
            : undefined
      await log(
        "pause",
        "permission.ask",
        typeof i.sessionID === "string" ? i.sessionID : undefined,
        {
          permission_id: i.id,
          permission_type: i.type ?? i.permission,
          title: i.title,
          patterns,
        },
      )
      // Intentionally does NOT mutate `output.status` — pure observer.
    },
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "question") return
      const header = output.args?.questions?.[0]?.header
      await log("pause", "question.ask", input.sessionID, {
        header: typeof header === "string" ? header : undefined,
      })
    },
    "tool.execute.after": async (input) => {
      if (input.tool !== "question") return
      // The tool's structured answer isn't surfaced to the after-hook in a
      // shape worth logging; recording the resume edge is the point.
      await log("start", "question.reply", input.sessionID)
    },
    event: async ({ event }) => {
      // Only reply-side events reach the bus reliably. Ask-side events
      // (permission.asked / question.asked) are documented in v2 typings but
      // never observed at runtime — handled via the hooks above instead.
      const e = event as unknown as { type: string; properties?: any }
      const p = e.properties ?? {}
      switch (e.type) {
        case "session.idle":
          await log("pause", e.type, p.sessionID)
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
        case "session.error":
          await log("pause", e.type, p.sessionID, {
            error_name: p.error?.name,
          })
          break
      }
    },
  }
}
