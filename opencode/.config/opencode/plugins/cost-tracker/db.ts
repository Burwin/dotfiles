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
//   Phase 4 (zen reconciliation, tier: sota) — `zen_daily_billed` table
//     is declared in BOOTSTRAP_SQL here (single source of schema truth);
//     UPSERTs come from the CLI side (../../opencode-cost/zen-sync.ts).
//     The plugin runs on every opencode session start so the table
//     materializes on first run, before the CLI ever touches the DB.
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
  /** Sum of 5m + 1h cache writes — kept for backward compat. */
  tokens_cache_write: number
  /** Per-tier cache write breakdown (added in §4.3 / Commit 4 / P4.2).
   *  Nullable on legacy rows captured before the split landed. */
  tokens_cache_write_5m: number | null
  tokens_cache_write_1h: number | null
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

// BOOTSTRAP_SQL — idempotent, includes WAL mode. Single source of schema
// truth; see PLAN.md (cost-tracker) §5 + PLAN.md (pertask-tmux-status)
// §4.1 (zen_usage) and §4.3 (cache TTL split).
//
// Fresh-DB path: `CREATE TABLE IF NOT EXISTS messages (... including
// tokens_cache_write_5m / tokens_cache_write_1h)` covers any first run.
// Existing-DB path: the ALTER TABLE statements in `openDb()` (below)
// add the new columns on top of older schemas, guarded by a duplicate-
// column catch so re-running them is harmless.
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
  tokens_cache_write_5m INTEGER,
  tokens_cache_write_1h INTEGER,
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

CREATE TABLE IF NOT EXISTS zen_daily_billed (
  date             TEXT NOT NULL,
  model            TEXT NOT NULL,
  key_id           TEXT NOT NULL,
  plan             TEXT,
  total_cost_fxp8  INTEGER NOT NULL,
  fetched_at       TEXT NOT NULL,
  PRIMARY KEY (date, model, key_id)
);

-- §4.1 zen_usage — per-row Zen ground truth. Populated by
-- opencode-cost zen-sync (../../opencode-cost/zen-sync.ts).
-- zen_daily_billed is derived from this table after each sync via
-- UPSERT GROUP BY (date, model, key_id).
CREATE TABLE IF NOT EXISTS zen_usage (
  id                       TEXT PRIMARY KEY,
  workspace_id             TEXT NOT NULL,
  session_id               TEXT,
  key_id                   TEXT NOT NULL,
  model                    TEXT NOT NULL,
  provider                 TEXT NOT NULL,
  time_created             TEXT NOT NULL,
  time_updated             TEXT NOT NULL,
  time_deleted             TEXT,
  input_tokens             INTEGER NOT NULL,
  output_tokens            INTEGER NOT NULL,
  reasoning_tokens         INTEGER,
  cache_read_tokens        INTEGER NOT NULL,
  cache_write_5m_tokens    INTEGER,
  cache_write_1h_tokens    INTEGER,
  cost_fxp8                INTEGER NOT NULL,
  enrichment_json          TEXT,
  fetched_at               TEXT NOT NULL,
  raw_json                 TEXT
);
CREATE INDEX IF NOT EXISTS idx_zen_usage_session ON zen_usage(session_id);
CREATE INDEX IF NOT EXISTS idx_zen_usage_day     ON zen_usage(substr(time_created, 1, 10), model);
CREATE INDEX IF NOT EXISTS idx_zen_usage_time    ON zen_usage(time_created);
`

// In-place migrations for existing DBs created before the new columns
// landed. SQLite raises `duplicate column name` if the column already
// exists; we swallow that specific error so the migration is idempotent.
// Listed separately from BOOTSTRAP_SQL because `db.exec()` aborts the
// whole batch on the first error — splitting them lets us catch each
// column-add individually without losing later migrations.
//
// Exported so the CLI (../../opencode-cost/zen-sync.ts) can apply the
// same migrations defensively before it writes to zen_usage on a DB
// where the plugin hasn't yet been reloaded under the new schema.
export const MIGRATIONS: ReadonlyArray<{ sql: string; column: string }> = [
  {
    column: "tokens_cache_write_5m",
    sql: "ALTER TABLE messages ADD COLUMN tokens_cache_write_5m INTEGER",
  },
  {
    column: "tokens_cache_write_1h",
    sql: "ALTER TABLE messages ADD COLUMN tokens_cache_write_1h INTEGER",
  },
]

/**
 * Apply BOOTSTRAP_SQL + MIGRATIONS to an already-open Database handle.
 * Idempotent (`CREATE TABLE IF NOT EXISTS` + the duplicate-column catch
 * on each ALTER). Shared by `openDb()` (plugin path) and the CLI
 * (`opencode-cost zen-sync`) so both surfaces converge on the same
 * schema regardless of which one runs first against a given DB file.
 */
export const applySchema = (db: any): void => {
  db.exec(BOOTSTRAP_SQL)
  for (const m of MIGRATIONS) {
    try {
      db.exec(m.sql)
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      if (!/duplicate column name/i.test(msg)) {
        console.warn(`[cost-tracker] migration "${m.column}" failed:`, e)
      }
    }
  }
}

export type DbHandle = {
  messages: {
    upsert: (row: MessageRow) => Promise<void>
  }
  sessionRollup: {
    upsert: (row: SessionRollupRow) => Promise<void>
    computeAndUpsert: (sessionId: string, tsLastIdle: string) => Promise<SessionRollupRow | null>
  }
  providerRates: {
    upsert: (rateVersion: string, payloadJson: string) => Promise<void>
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
      applySchema(db)
    } catch (e) {
      console.warn("[cost-tracker] schema bootstrap failed:", e)
      return null
    }

    const upsertMessage = (row: MessageRow): void => {
      db.query(`
        INSERT OR REPLACE INTO messages (
          message_id, session_id, worktree_path, provider_id, model_id,
          agent, ts_created, ts_completed, tokens_input, tokens_output,
          tokens_reasoning, tokens_cache_read, tokens_cache_write,
          tokens_cache_write_5m, tokens_cache_write_1h,
          cost_opencode_fxp8, cost_recomputed_fxp8, rate_version, finish, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.message_id, row.session_id, row.worktree_path, row.provider_id,
        row.model_id, row.agent, row.ts_created, row.ts_completed,
        row.tokens_input, row.tokens_output, row.tokens_reasoning,
        row.tokens_cache_read, row.tokens_cache_write,
        row.tokens_cache_write_5m, row.tokens_cache_write_1h,
        row.cost_opencode_fxp8, row.cost_recomputed_fxp8, row.rate_version,
        row.finish, row.raw_json
      )
    }

    const upsertSessionRollup = (row: SessionRollupRow): void => {
      db.query(`
        INSERT OR REPLACE INTO session_rollup (
          session_id, ts_last_idle, total_cost_opencode_fxp8,
          total_cost_recomputed_fxp8, message_count
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        row.session_id, row.ts_last_idle, row.total_cost_opencode_fxp8,
        row.total_cost_recomputed_fxp8, row.message_count
      )
    }

    const computeSessionRollupRow = (sessionId: string, tsLastIdle: string): SessionRollupRow | null => {
      const row = db.query(`
        SELECT
          SUM(cost_opencode_fxp8) as cost_opencode,
          SUM(cost_recomputed_fxp8) as cost_recomputed,
          COUNT(*) as cnt
        FROM messages WHERE session_id = ?
      `).get(sessionId) as any

      if (!row || (row.cnt ?? 0) === 0) return null

      return {
        session_id: sessionId,
        ts_last_idle: tsLastIdle,
        total_cost_opencode_fxp8: row.cost_opencode ?? 0,
        total_cost_recomputed_fxp8: row.cost_recomputed ?? 0,
        message_count: row.cnt ?? 0,
      }
    }

    return {
      messages: {
        upsert: async (row: MessageRow) => upsertMessage(row),
      },
      sessionRollup: {
        upsert: async (row: SessionRollupRow) => upsertSessionRollup(row),
        computeAndUpsert: async (sessionId: string, tsLastIdle: string) => {
          const rollup = computeSessionRollupRow(sessionId, tsLastIdle)
          if (rollup) upsertSessionRollup(rollup)
          return rollup
        },
      },
      providerRates: {
        upsert: async (rateVersion: string, payloadJson: string) => {
          db.query(`
            INSERT OR IGNORE INTO provider_rates (rate_version, fetched_at, payload_json)
            VALUES (?, ?, ?)
          `).run(rateVersion, new Date().toISOString(), payloadJson)
        },
      },
    }
  })()

  return openDbPromise
}
