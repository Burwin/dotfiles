// opencode-cost/reconcile.ts — `dump reconciliation` subcommand for the
// opencode-cost CLI (../bin/opencode-cost). Joins our per-session
// recompute against Zen's daily per-model billed totals, surfacing the
// drift in three columns.
//
// Design and rationale: ../../../../docs/plans/opencode-cost-tracker/PLAN.md
//
// Phase ownership of this file:
//   Phase 4 (zen reconciliation, tier: sota) — implements the daily-join
//     SQL and the formatter.
//
// Output columns:
//   date | model | recomputed_$ | tui_$ | zen_billed_$ | recompute_delta_$ | tui_delta_$
//
//   recompute_delta_$ = recomputed_$ - zen_billed_$
//   tui_delta_$       = tui_$        - zen_billed_$
//
// All fxp8 INTEGER in storage; format as decimals at display time only.
// Default output is a column-aligned table; pass --csv or --json to
// override.

import { Database } from "bun:sqlite"

const HOME = process.env.HOME ?? "/root"
const DB_PATH = process.env.OPENCODE_COST_DB ?? `${HOME}/.local/state/opencode-cost.db`

type Format = "table" | "json" | "csv"

type ReconcileOptions = {
  month?: string          // "YYYY-MM"; defaults to "all months"
  format: Format
}

type ArgsResult =
  | { ok: true; opts: ReconcileOptions }
  | { ok: false; error: string }

const parseArgs = (argv: string[]): ArgsResult => {
  let month: string | undefined
  let format: Format | undefined

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--json" || a === "--csv" || a === "--table") {
      const f = a.slice(2) as Format
      if (format !== undefined && format !== f) {
        return { ok: false, error: "--json, --csv, and --table are mutually exclusive" }
      }
      format = f
    } else if (a === "--month") {
      const v = argv[++i]
      if (v === undefined) return { ok: false, error: "--month requires YYYY-MM" }
      month = v
    } else if (a.startsWith("--month=")) {
      month = a.slice("--month=".length)
    } else {
      return { ok: false, error: `unknown argument: ${a}` }
    }
  }

  if (month !== undefined && !/^\d{4}-\d{2}$/.test(month)) {
    return { ok: false, error: `--month must be YYYY-MM (got "${month}")` }
  }

  return { ok: true, opts: { month, format: format ?? "table" } }
}

// Row shape after the SQL pulls everything. INTEGER fxp8 throughout;
// NULL where either side has no rows for that (date, model) cell.
type Row = {
  date: string
  model: string
  recomputed_fxp8: number | null
  tui_fxp8: number | null
  zen_fxp8: number | null
  recompute_delta_fxp8: number | null
  tui_delta_fxp8: number | null
}

// SQL: SQLite doesn't support FULL OUTER JOIN, so emulate with a UNION
// of two LEFT JOINs. The shapes match exactly so we can `UNION` (which
// also de-dups; rows that appear on both sides collapse to one).
//
// Both sub-SELECTs SUM by (date, model) and ignore key_id and plan in
// the join — the recomputed side doesn't know about Zen's key/plan
// dimensions, and zen_daily_billed is per-key so we add across keys to
// get a per-model daily total.
const SQL = `
  WITH recomputed AS (
    SELECT
      substr(ts_created, 1, 10) AS date,
      model_id                  AS model,
      SUM(cost_recomputed_fxp8) AS rc_fxp8,
      SUM(cost_opencode_fxp8)   AS tui_fxp8
    FROM messages
    WHERE (:month_filter = '' OR substr(ts_created, 1, 7) = :month_filter)
    GROUP BY date, model
  ),
  billed AS (
    SELECT
      date,
      model,
      SUM(total_cost_fxp8) AS zen_fxp8
    FROM zen_daily_billed
    WHERE (:month_filter = '' OR substr(date, 1, 7) = :month_filter)
    GROUP BY date, model
  )
  SELECT
    r.date  AS date,
    r.model AS model,
    r.rc_fxp8                   AS recomputed_fxp8,
    r.tui_fxp8                  AS tui_fxp8,
    b.zen_fxp8                  AS zen_fxp8,
    (r.rc_fxp8  - COALESCE(b.zen_fxp8, 0))  AS recompute_delta_fxp8,
    (r.tui_fxp8 - COALESCE(b.zen_fxp8, 0))  AS tui_delta_fxp8
  FROM recomputed r
  LEFT JOIN billed b USING (date, model)

  UNION

  SELECT
    b.date  AS date,
    b.model AS model,
    r.rc_fxp8                   AS recomputed_fxp8,
    r.tui_fxp8                  AS tui_fxp8,
    b.zen_fxp8                  AS zen_fxp8,
    (COALESCE(r.rc_fxp8, 0)  - b.zen_fxp8)  AS recompute_delta_fxp8,
    (COALESCE(r.tui_fxp8, 0) - b.zen_fxp8)  AS tui_delta_fxp8
  FROM billed b
  LEFT JOIN recomputed r USING (date, model)

  ORDER BY date DESC, model;
`

// --------------------------------------------------------------------------
// Formatters
// --------------------------------------------------------------------------

const fmtDollars = (fxp8: number | null): string => {
  if (fxp8 === null || fxp8 === undefined) return ""
  const dollars = fxp8 / 1e8
  // Two decimals for amounts ≥ $0.01; six decimals for smaller (gpt-5-nano
  // can be sub-cent per request). Threshold chosen so a row reading
  // $0.000033 stays readable instead of collapsing to $0.00.
  if (Math.abs(dollars) >= 0.01 || dollars === 0) return dollars.toFixed(2)
  return dollars.toFixed(6)
}

const fmtSignedDollars = (fxp8: number | null): string => {
  if (fxp8 === null || fxp8 === undefined) return ""
  const s = fmtDollars(fxp8)
  if (fxp8 > 0 && !s.startsWith("+")) return `+${s}`
  return s
}

const writeJson = (rows: Row[]) => {
  process.stdout.write(JSON.stringify(rows))
  process.stdout.write("\n")
}

const writeCsv = (rows: Row[]) => {
  const headers = [
    "date", "model",
    "recomputed_fxp8", "tui_fxp8", "zen_billed_fxp8",
    "recompute_delta_fxp8", "tui_delta_fxp8",
  ]
  process.stdout.write(headers.join(",") + "\n")
  for (const r of rows) {
    const cells = [
      r.date,
      r.model,
      r.recomputed_fxp8 ?? "",
      r.tui_fxp8 ?? "",
      r.zen_fxp8 ?? "",
      r.recompute_delta_fxp8 ?? "",
      r.tui_delta_fxp8 ?? "",
    ].map(v => {
      const s = String(v ?? "")
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    })
    process.stdout.write(cells.join(",") + "\n")
  }
}

// Aligned table. Right-justify dollar columns so the decimal points
// line up visually; left-justify date and model.
const writeTable = (rows: Row[]) => {
  const headers = [
    "date", "model",
    "recomputed_$", "tui_$", "zen_billed_$",
    "recompute_delta_$", "tui_delta_$",
  ]
  const data = rows.map(r => [
    r.date,
    r.model,
    fmtDollars(r.recomputed_fxp8),
    fmtDollars(r.tui_fxp8),
    fmtDollars(r.zen_fxp8),
    fmtSignedDollars(r.recompute_delta_fxp8),
    fmtSignedDollars(r.tui_delta_fxp8),
  ])

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...data.map(r => r[i].length)),
  )
  // Left-justify columns 0,1 (date, model); right-justify the rest.
  const leftAlign = (s: string, w: number) => s.padEnd(w)
  const rightAlign = (s: string, w: number) => s.padStart(w)
  const fmt = (cells: string[]) =>
    cells.map((c, i) => i < 2 ? leftAlign(c, widths[i]) : rightAlign(c, widths[i])).join("  ")

  process.stdout.write(fmt(headers) + "\n")
  process.stdout.write(widths.map(w => "-".repeat(w)).join("  ") + "\n")
  for (const r of data) process.stdout.write(fmt(r) + "\n")

  if (rows.length === 0) {
    process.stdout.write("\n(no rows — either messages or zen_daily_billed is empty)\n")
  }
}

// --------------------------------------------------------------------------
// Entry
// --------------------------------------------------------------------------

export const runReconciliation = (argv: string[]): number => {
  const parsed = parseArgs(argv)
  if (!parsed.ok) {
    console.error(`opencode-cost: ${parsed.error}`)
    return 2
  }
  const { month, format } = parsed.opts

  let db: Database
  try {
    db = new Database(DB_PATH, { readonly: true })
  } catch (e: any) {
    console.error(`opencode-cost: cannot open ${DB_PATH} (${e?.message ?? e})`)
    console.error("opencode-cost: run an opencode session first to create the DB.")
    return 1
  }

  let rows: Row[]
  try {
    rows = db.query(SQL).all({ ":month_filter": month ?? "" }) as Row[]
  } catch (e: any) {
    console.error(`opencode-cost: reconciliation query failed (${e?.message ?? e})`)
    db.close()
    return 1
  } finally {
    // close happens below
  }
  db.close()

  if (format === "json") writeJson(rows)
  else if (format === "csv") writeCsv(rows)
  else writeTable(rows)
  return 0
}
