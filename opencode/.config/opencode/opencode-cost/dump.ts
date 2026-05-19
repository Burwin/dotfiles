// opencode-cost/dump.ts — `dump messages` and `dump sessions` subcommands
// for the opencode-cost CLI (../bin/opencode-cost).
//
// Design and rationale: ../../../../docs/plans/opencode-cost-tracker/PLAN.md
//
// Phase ownership of this file:
//   Phase 3 (CLI dump, tier: cheap) — implement `runDumpMessages` and
//     `runDumpSessions`. Both accept `{ since?: string, format: "json"|"csv" }`,
//     query ~/.local/state/opencode-cost.db read-only, write to stdout.
//
// Output format:
//   --json   one JSON array per row set; numeric fxp8 columns NOT divided
//            (let the caller decide; jq one-liner is `.[] | .cost_fxp8 / 1e8`).
//   --csv    headers from column names; numeric fxp8 columns NOT divided
//            (same rationale).
//
// We intentionally don't divide by 1e8 here. Two reasons:
//   1. INTEGER columns stay byte-exact through the pipe.
//   2. Composability — downstream consumers (gnuplot, awk, jq) can
//      decide precision and formatting.
//
// THIS FILE IS A STUB. Phase 3 fills in the queries + formatters; see
// PLAN.md §6 Phase 3.

export type DumpOptions = {
  since?: string             // YYYY-MM-DD
  format: "json" | "csv"
}

// Phase 3 fills in:
//
//   export async function runDumpMessages(argv: string[]): Promise<number>
//   export async function runDumpSessions(argv: string[]): Promise<number>
//
// Both:
//   - parse `--since` and `--json`/`--csv` from argv
//   - open ~/.local/state/opencode-cost.db readonly
//   - SELECT * FROM {messages|session_rollup} [WHERE ts_* >= ?]
//   - write JSON array or CSV with headers to stdout
//   - return process exit code (0 ok, non-zero on parse / DB open failure)
