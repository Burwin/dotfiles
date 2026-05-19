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

// BOOTSTRAP_SQL lands here in Phase 1, matching PLAN.md §5 exactly.
// Idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`),
// includes `PRAGMA journal_mode=WAL`.
export const BOOTSTRAP_SQL = "" // TODO Phase 1: fill in per PLAN.md §5.

// Phase 1 fills in: openDb(), upsertMessage(row), upsertRollup(sessionID,
// nowIso). All best-effort: any thrown error from SQL must be caught at
// the call site and swallowed so the plugin never crashes opencode.
export const openDb = async (): Promise<null> => {
  // TODO Phase 1: dynamic-import bun:sqlite; mkdir parent dir; open DB
  // with { create: true }; run BOOTSTRAP_SQL; return prepared-statement
  // bundle. Cache the open Promise so re-entry returns the same handle.
  return null
}
