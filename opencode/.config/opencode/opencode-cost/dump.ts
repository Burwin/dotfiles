// opencode-cost/dump.ts — `dump messages` and `dump sessions` subcommands
// for the opencode-cost CLI (../bin/opencode-cost).
//
// Design and rationale: ../../../../docs/archive/opencode/PLAN-cost-tracker.md
//
// Phase ownership of this file:
//   Phase 3 (CLI dump, tier: cheap) — `runDumpMessages` and `runDumpSessions`.
//     Both accept argv (no leading subcommand), parse `--since` and
//     `--json|--csv`, query ~/.local/state/opencode-cost.db read-only, and
//     write to stdout. Return process exit code (0 ok, 1 DB/query failure,
//     2 arg parse failure).
//
// Output format:
//   --json   single JSON array; jq-friendly with `.[]`. fxp8 columns left
//            as INTEGER — divide at the consumer (`.[] | .cost_recomputed_fxp8 / 1e8`).
//   --csv    headers from PRAGMA table_info (resilient to schema additions);
//            fxp8 columns left as INTEGER for the same reason.
//
// We intentionally don't divide by 1e8 here. Two reasons:
//   1. INTEGER columns stay byte-exact through the pipe.
//   2. Composability — downstream consumers (gnuplot, awk, jq) decide
//      precision and formatting.

import { Database } from "bun:sqlite"

// DB path resolution mirrors plugins/cost-tracker/db.ts. Read-only here —
// the CLI must never write to the cost-tracker DB. Override via the same
// OPENCODE_COST_DB env var that the plugin honours (used in tests).
const DB_PATH =
  process.env.OPENCODE_COST_DB ??
  `${process.env.HOME ?? "/root"}/.local/state/opencode-cost.db`

export type DumpOptions = {
  since?: string             // YYYY-MM-DD
  format: "json" | "csv"
}

type ArgsResult =
  | { ok: true; opts: DumpOptions }
  | { ok: false; error: string }

// Minimal hand-rolled parser — three flags, mutually-exclusive format,
// strict on unknowns so typos don't silently degrade to "dump everything".
const parseArgs = (argv: string[]): ArgsResult => {
  let since: string | undefined
  let format: DumpOptions["format"] | undefined

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--json" || a === "--csv") {
      const f = a.slice(2) as DumpOptions["format"]
      if (format !== undefined && format !== f) {
        return { ok: false, error: "--json and --csv are mutually exclusive" }
      }
      format = f
    } else if (a === "--since") {
      const v = argv[++i]
      if (v === undefined) return { ok: false, error: "--since requires a date argument" }
      since = v
    } else if (a.startsWith("--since=")) {
      since = a.slice("--since=".length)
    } else {
      return { ok: false, error: `unknown argument: ${a}` }
    }
  }

  if (since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    return { ok: false, error: `--since must be YYYY-MM-DD (got "${since}")` }
  }

  return { ok: true, opts: { since, format: format ?? "json" } }
}

// RFC 4180-ish: wrap values containing comma/quote/CR/LF in double-quotes
// and escape embedded quotes by doubling. Null/undefined render empty.
const csvEscape = (v: unknown): string => {
  if (v === null || v === undefined) return ""
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const writeJson = (rows: unknown[]) => {
  // Single JSON array; no whitespace — keeps a 10K-row dump under 100KB
  // and stays jq-friendly (`.[]` works the same either way).
  process.stdout.write(JSON.stringify(rows))
  process.stdout.write("\n")
}

const writeCsv = (headers: string[], rows: Record<string, unknown>[]) => {
  process.stdout.write(headers.join(",") + "\n")
  for (const row of rows) {
    process.stdout.write(headers.map(h => csvEscape(row[h])).join(",") + "\n")
  }
}

const runDump = (
  table: "messages" | "session_rollup",
  tsCol: "ts_created" | "ts_last_idle",
  argv: string[],
): number => {
  const parsed = parseArgs(argv)
  if (!parsed.ok) {
    console.error(`opencode-cost: ${parsed.error}`)
    return 2
  }
  const { since, format } = parsed.opts

  let db: Database
  try {
    db = new Database(DB_PATH, { readonly: true })
  } catch (e: any) {
    console.error(`opencode-cost: cannot open ${DB_PATH} (${e?.message ?? e})`)
    console.error("opencode-cost: run an opencode session first to create the DB.")
    return 1
  }

  try {
    // PRAGMA table_info returns ordered columns; survives schema additions
    // without code changes here (schema lives in plugins/cost-tracker/db.ts).
    const cols = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]
    if (cols.length === 0) {
      console.error(`opencode-cost: table '${table}' not found in ${DB_PATH}`)
      return 1
    }
    const headers = cols.map(c => c.name)

    // ASC by timestamp — natural order for time-series analysis downstream.
    // The reconcile report (Phase 4) re-sorts DESC at its display layer.
    const sql = since
      ? `SELECT * FROM ${table} WHERE substr(${tsCol}, 1, 10) >= ? ORDER BY ${tsCol}`
      : `SELECT * FROM ${table} ORDER BY ${tsCol}`
    const rows = (
      since ? db.query(sql).all(since) : db.query(sql).all()
    ) as Record<string, unknown>[]

    if (format === "json") writeJson(rows)
    else writeCsv(headers, rows)
    return 0
  } catch (e: any) {
    console.error(`opencode-cost: query failed (${e?.message ?? e})`)
    return 1
  } finally {
    db.close()
  }
}

export const runDumpMessages = (argv: string[]): number =>
  runDump("messages", "ts_created", argv)

export const runDumpSessions = (argv: string[]): number =>
  runDump("session_rollup", "ts_last_idle", argv)
