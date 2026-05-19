// cost-tracker/db.ts — schema bootstrap + prepared statements for the
// opencode cost-tracker plugin (../cost-tracker.ts).
//
// Design and rationale: ../../../../../docs/plans/opencode-cost-tracker/PLAN.md
//
// Phase ownership of this file:
//   Phase 1 (capture, tier: cheap) — define BOOTSTRAP_SQL exactly as
//     shown in PLAN.md §5, plus prepared INSERT statements for `messages`
//     and `session_rollup`. Open `bun:sqlite` defensively (dynamic
//     import inside try/catch; best-effort mkdir of the parent dir;
//     return null on any failure so the plugin no-ops).
//   Phase 4 (zen reconciliation, tier: sota) — adds `zen_daily_billed`
//     INSERTs from the CLI side (not this file).
//
// Lives in this `cost-tracker/` subdirectory (not next to cost-tracker.ts)
// for the same reason notify/ exists: opencode's plugin loader uses the
// non-recursive glob `{plugin,plugins}/*.{ts,js}` and would try to load
// helpers as plugins otherwise.
//
// Storage location: ~/.local/state/opencode-cost.db. Independent of
// opencode's own `~/.local/share/opencode/opencode.db` — we never write
// to or schema-couple with it. Override via OPENCODE_COST_DB env var (for
// tests; mirrors toggl-time.ts's TOGGL_STATE_DB convention).
//
// Unit convention: all dollar amounts are INTEGER, stored as fxp8
// (USD × 10⁸). Divide by 1e8 only at display time.
//
// THIS FILE IS A STUB. Phase 1 fills in `openDb()` and the prepared-
// statement wrappers; see PLAN.md §5 + §6 Phase 1.

// Phase 1 will export these. Defined here so the file parses cleanly and
// downstream stubs can import the types.

export type MessageRow = {
  message_id: string
  session_id: string
  worktree_path: string
  provider_id: string
  model_id: string
  agent: string | null
  ts_created: string
  ts_completed: string | null
  tokens_input: number
  tokens_output: number
  tokens_reasoning: number
  tokens_cache_read: number
  tokens_cache_write: number
  cost_opencode_fxp8: number
  cost_recomputed_fxp8: number
  rate_version: string
  finish: string | null
  raw_json: string
}

export type SessionRollupRow = {
  session_id: string
  ts_last_idle: string
  total_cost_opencode_fxp8: number
  total_cost_recomputed_fxp8: number
  message_count: number
}

// BOOTSTRAP_SQL per PLAN.md §5 — idempotent, includes WAL mode.
export const BOOTSTRAP_SQL = `
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS messages (
  message_id            TEXT PRIMARY KEY,
  session_id            TEXT NOT NULL,
  worktree_path         TEXT NOT NULL,
  provider_id           TEXT NOT NULL,
  model_id              TEXT NOT NULL,
  agent                 TEXT,
  ts_created            TEXT NOT NULL,
  ts_completed          TEXT,
  tokens_input          INTEGER NOT NULL,
  tokens_output         INTEGER NOT NULL,
  tokens_reasoning      INTEGER NOT NULL,
  tokens_cache_read     INTEGER NOT NULL,
  tokens_cache_write    INTEGER NOT NULL,
  cost_opencode_fxp8    INTEGER NOT NULL,
  cost_recomputed_fxp8  INTEGER NOT NULL,
  rate_version          TEXT NOT NULL,
  finish                TEXT,
  raw_json              TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, ts_created);
CREATE INDEX IF NOT EXISTS idx_messages_day ON messages(substr(ts_created, 1, 10), model_id);

CREATE TABLE IF NOT EXISTS session_rollup (
  session_id                  TEXT PRIMARY KEY,
  ts_last_idle                TEXT NOT NULL,
  total_cost_opencode_fxp8    INTEGER NOT NULL,
  total_cost_recomputed_fxp8  INTEGER NOT NULL,
  message_count               INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_rates (
  rate_version  TEXT PRIMARY KEY,
  fetched_at    TEXT NOT NULL,
  payload_json  TEXT NOT NULL
);
`

type DbHandle = {
  messages: {
    upsert: (row: MessageRow) => Promise<void>
  }
  sessionRollup: {
    upsert: (row: SessionRollupRow) => Promise<void>
  }
}

let openDbPromise: Promise<DbHandle | null> | null = null

export const openDb = async (): Promise<DbHandle | null> => {
  if (openDbPromise) return openDbPromise

  openDbPromise = (async () => {
    let sqlite: any
    try {
      sqlite = await import("bun:sqlite")
    } catch {
      console.warn("[cost-tracker] bun:sqlite not available, disabling")
      return null
    }

    const dbDir = ".local/state"
    const dbPath = process.env.OPENCODE_COST_DB ?? `${process.env.HOME ?? "/root"}/${dbDir}/opencode-cost.db`

    try {
      await import("fs").then(fs => {
        if (!fs.existsSync(dbPath)) {
          fs.mkdirSync(dbPath.replace(/\/[^/]+$/, ""), { recursive: true })
        }
      })
    } catch {
      // Best-effort mkdir — may fail on read-only or weird configs
    }

    let db: any
    try {
      db = new sqlite.Database(dbPath, { create: true })
    } catch {
      console.warn("[cost-tracker] failed to open DB, disabling")
      return null
    }

    try {
      db.exec(BOOTSTRAP_SQL)
    } catch (e) {
      console.warn("[cost-tracker] schema bootstrap failed:", e)
      return null
    }

    return {
      messages: {
        upsert: async (row: MessageRow) => {
          db.query(`
            INSERT OR REPLACE INTO messages (
              message_id, session_id, worktree_path, provider_id, model_id,
              agent, ts_created, ts_completed, tokens_input, tokens_output,
              tokens_reasoning, tokens_cache_read, tokens_cache_write,
              cost_opencode_fxp8, cost_recomputed_fxp8, rate_version, finish, raw_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            row.message_id, row.session_id, row.worktree_path, row.provider_id,
            row.model_id, row.agent, row.ts_created, row.ts_completed,
            row.tokens_input, row.tokens_output, row.tokens_reasoning,
            row.tokens_cache_read, row.tokens_cache_write, row.cost_opencode_fxp8,
            row.cost_recomputed_fxp8, row.rate_version, row.finish, row.raw_json
          )
        },
      },
      sessionRollup: {
        upsert: async (row: SessionRollupRow) => {
          db.query(`
            INSERT OR REPLACE INTO session_rollup (
              session_id, ts_last_idle, total_cost_opencode_fxp8,
              total_cost_recomputed_fxp8, message_count
            ) VALUES (?, ?, ?, ?, ?)
          `).run(
            row.session_id, row.ts_last_idle, row.total_cost_opencode_fxp8,
            row.total_cost_recomputed_fxp8, row.message_count
          )
        },
      },
    }
  })()

  return openDbPromise
}

export const computeSessionRollup = async (
  db: DbHandle,
  sessionId: string,
  tsLastIdle: string
): Promise<SessionRollupRow | null> => {
  const row = db.query(`
    SELECT
      SUM(tokens_input) as ti,
      SUM(tokens_output) as to,
      SUM(tokens_reasoning) as tr,
      SUM(tokens_cache_read) as tcr,
      SUM(tokens_cache_write) as tcw,
      SUM(cost_opencode_fxp8) as cost_opencode,
      SUM(cost_recomputed_fxp8) as cost_recomputed,
      COUNT(*) as cnt
    FROM messages WHERE session_id = ?
  `).get(sessionId) as any

  if (!row) return null

  return {
    session_id: sessionId,
    ts_last_idle: tsLastIdle,
    total_cost_opencode_fxp8: row.cost_opencode ?? 0,
    total_cost_recomputed_fxp8: row.cost_recomputed ?? 0,
    message_count: row.cnt ?? 0,
  }
}
