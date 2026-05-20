// opencode-cost/reconcile.ts — `dump reconciliation` subcommand for the
// opencode-cost CLI (../bin/opencode-cost). Joins our per-session
// recompute against Zen's daily per-model billed totals, surfacing the
// drift in three columns.
//
// Design and rationale: ../../../../docs/plans/opencode-cost-tracker/PLAN.md
//   plus ../../../../docs/plans/opencode-cost-pertask-tmux-status/PLAN.md
//   §6.2 (per-message reconcile mode, new in Commit 5).
//
// Phase ownership of this file:
//   Phase 4 (zen reconciliation, tier: sota) — implements the daily-join
//     SQL and the formatter.
//   Commit 5 of the per-task PLAN — `--by-message [--session ses_xxx]
//     [--since YYYY-MM-DD]` mode joins `messages` to `zen_usage` with a
//     5-second time window (per §6.2) and surfaces per-row drift.
//
// Output columns (daily mode):
//   date | model | recomputed_$ | tui_$ | zen_billed_$ | recompute_delta_$ | tui_delta_$
//
//   recompute_delta_$ = recomputed_$ - zen_billed_$
//   tui_delta_$       = tui_$        - zen_billed_$
//
// Output columns (--by-message mode, per §6.2):
//   session_id | local_ts | zen_ts | model_id | tui_$ | zen_$ | drift_$ |
//     input_delta | output_delta | cache_read_delta | cache_5m_delta | cache_1h_delta
//
//   `cost_recomputed_fxp8` is omitted here per the per-request PLAN's
//   archived R5 decision: with per-row Zen truth available, tier-aware
//   recompute becomes diagnostic-only and adds noise to the message
//   view.
//
// All fxp8 INTEGER in storage; format as decimals at display time only.
// Default output is a column-aligned table; pass --csv or --json to
// override.

import { Database } from "bun:sqlite"

const HOME = process.env.HOME ?? "/root"
const DB_PATH = process.env.OPENCODE_COST_DB ?? `${HOME}/.local/state/opencode-cost.db`

type Format = "table" | "json" | "csv"

type ReconcileOptions = {
  byMessage: boolean
  month?: string          // "YYYY-MM"; defaults to "all months". Daily-mode only.
  session?: string        // ses_*; --by-message only.
  since?: string          // YYYY-MM-DD; --by-message only.
  format: Format
}

type ArgsResult =
  | { ok: true; opts: ReconcileOptions }
  | { ok: false; error: string }

const parseArgs = (argv: string[]): ArgsResult => {
  let byMessage = false
  let month: string | undefined
  let session: string | undefined
  let since: string | undefined
  let format: Format | undefined

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--by-message") {
      byMessage = true
    } else if (a === "--json" || a === "--csv" || a === "--table") {
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
    } else if (a === "--session") {
      const v = argv[++i]
      if (v === undefined) return { ok: false, error: "--session requires a value" }
      session = v
    } else if (a.startsWith("--session=")) {
      session = a.slice("--session=".length)
    } else if (a === "--since") {
      const v = argv[++i]
      if (v === undefined) return { ok: false, error: "--since requires YYYY-MM-DD" }
      since = v
    } else if (a.startsWith("--since=")) {
      since = a.slice("--since=".length)
    } else {
      return { ok: false, error: `unknown argument: ${a}` }
    }
  }

  if (month !== undefined && !/^\d{4}-\d{2}$/.test(month)) {
    return { ok: false, error: `--month must be YYYY-MM (got "${month}")` }
  }
  if (since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    return { ok: false, error: `--since must be YYYY-MM-DD (got "${since}")` }
  }

  // --session and --since only make sense with --by-message. --month
  // only makes sense in daily mode. Cross-mode flags are user errors.
  if (!byMessage && (session !== undefined || since !== undefined)) {
    return {
      ok: false,
      error: "--session / --since require --by-message (use --month for daily reconcile)",
    }
  }
  if (byMessage && month !== undefined) {
    return {
      ok: false,
      error: "--month is for daily reconcile only (use --since with --by-message)",
    }
  }

  return {
    ok: true,
    opts: { byMessage, month, session, since, format: format ?? "table" },
  }
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
// --by-message mode (per §6.2 of the per-task PLAN)
// --------------------------------------------------------------------------
//
// Joins messages → zen_usage on (session_id, model, ts within 5s). The
// 5-second join window absorbs clock skew between opencode's local
// capture timestamp and Zen's server-side row timestamp; both are real
// (NTP-synced) but the few hundred ms of recording lag means strict
// equality would miss most pairs.
//
// cost_recomputed_fxp8 is intentionally absent here. Per the per-request
// PLAN's archived R5 decision (now in §6.2 of this PLAN), with per-row
// Zen truth available the tier-aware recompute becomes diagnostic-only
// and would add noise to the per-message drift view.

type MessageRow = {
  session_id: string
  local_ts: string
  zen_ts: string | null
  model_id: string
  tui_fxp8: number | null
  zen_fxp8: number | null
  drift_fxp8: number | null
  input_delta: number | null
  output_delta: number | null
  cache_read_delta: number | null
  cache_5m_delta: number | null
  cache_1h_delta: number | null
}

const BY_MESSAGE_SQL = `
  SELECT
    m.session_id                                                    AS session_id,
    m.ts_created                                                    AS local_ts,
    zu.time_created                                                 AS zen_ts,
    m.model_id                                                      AS model_id,
    m.cost_opencode_fxp8                                            AS tui_fxp8,
    zu.cost_fxp8                                                    AS zen_fxp8,
    (zu.cost_fxp8 - m.cost_opencode_fxp8)                           AS drift_fxp8,
    (m.tokens_input          - zu.input_tokens)                      AS input_delta,
    (m.tokens_output         - zu.output_tokens)                     AS output_delta,
    (m.tokens_cache_read     - zu.cache_read_tokens)                 AS cache_read_delta,
    (m.tokens_cache_write_5m - zu.cache_write_5m_tokens)             AS cache_5m_delta,
    (m.tokens_cache_write_1h - zu.cache_write_1h_tokens)             AS cache_1h_delta
  FROM messages m
  LEFT JOIN zen_usage zu
    ON zu.session_id = m.session_id
    AND zu.model     = m.model_id
    AND ABS(strftime('%s', zu.time_created) - strftime('%s', m.ts_created)) < 5
  WHERE (:since = '' OR substr(m.ts_created, 1, 10) >= :since)
    AND (:session = '' OR m.session_id = :session)
  ORDER BY m.ts_created DESC
`

const fmtSigned4 = (fxp8: number | null): string => {
  if (fxp8 === null || fxp8 === undefined) return ""
  const dollars = fxp8 / 1e8
  const sign = fxp8 > 0 ? "+" : ""
  return `${sign}$${dollars.toFixed(4)}`
}

const fmt4 = (fxp8: number | null): string => {
  if (fxp8 === null || fxp8 === undefined) return ""
  return `$${(fxp8 / 1e8).toFixed(4)}`
}

const writeMessageJson = (rows: MessageRow[]) => {
  process.stdout.write(JSON.stringify(rows))
  process.stdout.write("\n")
}

const writeMessageCsv = (rows: MessageRow[]) => {
  const headers = [
    "session_id", "local_ts", "zen_ts", "model_id",
    "tui_fxp8", "zen_fxp8", "drift_fxp8",
    "input_delta", "output_delta",
    "cache_read_delta", "cache_5m_delta", "cache_1h_delta",
  ]
  process.stdout.write(headers.join(",") + "\n")
  for (const r of rows) {
    const cells = [
      r.session_id,
      r.local_ts,
      r.zen_ts ?? "",
      r.model_id,
      r.tui_fxp8 ?? "",
      r.zen_fxp8 ?? "",
      r.drift_fxp8 ?? "",
      r.input_delta ?? "",
      r.output_delta ?? "",
      r.cache_read_delta ?? "",
      r.cache_5m_delta ?? "",
      r.cache_1h_delta ?? "",
    ].map((v) => {
      const s = String(v ?? "")
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    })
    process.stdout.write(cells.join(",") + "\n")
  }
}

const writeMessageTable = (rows: MessageRow[]) => {
  const headers = [
    "session_id", "local_ts", "zen_ts", "model_id",
    "tui_$", "zen_$", "drift_$",
    "in_Δ", "out_Δ", "cr_Δ", "c5m_Δ", "c1h_Δ",
  ]
  const data = rows.map((r) => [
    r.session_id,
    r.local_ts,
    r.zen_ts ?? "",
    r.model_id,
    fmt4(r.tui_fxp8),
    fmt4(r.zen_fxp8),
    fmtSigned4(r.drift_fxp8),
    r.input_delta === null || r.input_delta === undefined ? "" : String(r.input_delta),
    r.output_delta === null || r.output_delta === undefined ? "" : String(r.output_delta),
    r.cache_read_delta === null || r.cache_read_delta === undefined ? "" : String(r.cache_read_delta),
    r.cache_5m_delta === null || r.cache_5m_delta === undefined ? "" : String(r.cache_5m_delta),
    r.cache_1h_delta === null || r.cache_1h_delta === undefined ? "" : String(r.cache_1h_delta),
  ])
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...data.map((r) => r[i].length)),
  )
  // First 4 columns are text (left-align); the rest are numeric (right-align).
  const TEXT_COLS = 4
  const fmt = (cells: string[]): string =>
    cells
      .map((c, i) => (i < TEXT_COLS ? c.padEnd(widths[i]) : c.padStart(widths[i])))
      .join("  ")

  process.stdout.write(fmt(headers) + "\n")
  process.stdout.write(widths.map((w) => "-".repeat(w)).join("  ") + "\n")
  for (const r of data) process.stdout.write(fmt(r) + "\n")

  if (rows.length === 0) {
    process.stdout.write(
      "\n(no rows — either messages is empty, the --since/--session filter " +
      "excluded everything, or no rows in the window have a matching " +
      "zen_usage entry within the 5-second join window)\n",
    )
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
  const { byMessage, month, session, since, format } = parsed.opts

  let db: Database
  try {
    db = new Database(DB_PATH, { readonly: true })
  } catch (e: any) {
    console.error(`opencode-cost: cannot open ${DB_PATH} (${e?.message ?? e})`)
    console.error("opencode-cost: run an opencode session first to create the DB.")
    return 1
  }

  try {
    if (byMessage) {
      let rows: MessageRow[]
      try {
        rows = db.query(BY_MESSAGE_SQL).all({
          ":since": since ?? "",
          ":session": session ?? "",
        }) as MessageRow[]
      } catch (e: any) {
        console.error(`opencode-cost: --by-message query failed (${e?.message ?? e})`)
        return 1
      }
      if (format === "json") writeMessageJson(rows)
      else if (format === "csv") writeMessageCsv(rows)
      else writeMessageTable(rows)
      return 0
    }

    let rows: Row[]
    try {
      rows = db.query(SQL).all({ ":month_filter": month ?? "" }) as Row[]
    } catch (e: any) {
      console.error(`opencode-cost: reconciliation query failed (${e?.message ?? e})`)
      return 1
    }

    if (format === "json") writeJson(rows)
    else if (format === "csv") writeCsv(rows)
    else writeTable(rows)
    return 0
  } finally {
    db.close()
  }
}
