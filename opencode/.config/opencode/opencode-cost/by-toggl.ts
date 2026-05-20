// opencode-cost/by-toggl.ts — `dump by-toggl` subcommand for the
// opencode-cost CLI (../bin/opencode-cost). Per-task / per-project /
// per-client cost rollup joining `zen_usage` to `messages` to
// `toggl.toggl_repo_state` per the §10.1.c join path.
//
// Design and rationale:
//   ../../../../docs/plans/opencode-cost-pertask-tmux-status/PLAN.md
//   §7.1 column shapes, §10.1 shared fixture / CLI surface, §10.2-§10.4
//   acceptance test contract.
//
// Phase ownership of this file:
//   Commit 5 / Z5 of the per-task PLAN — implements the §10.1.f CLI
//     surface (`--group-by task|project|client` required, optional
//     `--since` / `--until` / `--toggl-db` / `--include-unmapped` /
//     `--include-unattributed` / `--no-model-split` / `--json|--csv|--table`)
//     and produces the rollups specified by §10.2-§10.4.
//
// Join path (§10.1.c):
//
//   zen_usage.session_id  =  messages.session_id
//                            messages.worktree_path  =  toggl_repo_state.worktree_path
//                                                       └─ supplies client_name / project_name / task
//
// UNION buckets per §10.1.e:
//   1. mapped — zen_usage → messages → toggl_repo_state all matched.
//      Attributed to (client_name, project_name, task).
//   2. unmapped — messages match, toggl_repo_state does not. Surfaced
//      as the `(unmapped)` bucket. Cost counted; --no-include-unmapped
//      excludes from rollup.
//   3. unattributed (a.k.a. no-local-capture) — zen_usage rows with no
//      matching messages row. Surfaced as `(no-local-capture)`.
//      --no-include-unattributed excludes from rollup.
//
// Invariant contract (§10.1.d):
//   1. Sum-up consistency — task → project → client → grand totals match
//      SUM(zen_usage.cost_fxp8) over the window when both buckets are on.
//   2. Deterministic attribution — every zen_usage row contributes to
//      exactly one bucket via the UNION ALL + LEFT JOIN ... IS NULL idiom.
//   3. Stable across re-runs — deterministic ORDER BY (cost_fxp8 DESC
//      first, group cols ASC second) means byte-identical output for
//      the same DB snapshot.
//   4. No fxp8 → float round-trips inside aggregation — SUM(cost_fxp8)
//      is integer arithmetic in SQLite; we only divide by 1e8 at the
//      table-renderer's display layer. JSON/CSV emit raw INTEGER fxp8
//      (per the §10.1.f "JSON/CSV keep fxp8 INTEGER columns" contract).
//
// toggl.db missing (locked decision #8 in PLAN §2 + §10.1.e + §11.6):
//   Loud failure path. Exits with non-zero status and a diagnostic line
//   pointing the operator at toggl-set. The tmux bar deliberately
//   degrades silently in the same case; the contract divergence is
//   intentional and documented in PLAN §11.6.
//
// Multi-worktree session attribution (§14 open item 1):
//   The current implementation collapses messages.session_id → one
//   worktree_path via MIN() per session_id. Deterministic and 1-to-1
//   in practice today; revisit if the open item surfaces a real
//   session crossing worktrees.

import fs from "node:fs"
import { Database } from "bun:sqlite"

// --------------------------------------------------------------------------
// Paths and defaults
// --------------------------------------------------------------------------

const HOME = process.env.HOME ?? "/root"

// Env-driven paths are read at call time (not module load) so test
// harnesses can mutate `OPENCODE_COST_DB` / `TOGGL_STATE_DB` between
// individual test cases without re-importing the module. Production
// CLI runs are unaffected — the lookup costs ~one map read per call.
const resolveDbPath = (): string =>
  process.env.OPENCODE_COST_DB ?? `${HOME}/.local/state/opencode-cost.db`
const resolveDefaultTogglDb = (): string =>
  process.env.TOGGL_STATE_DB ?? `${HOME}/.local/state/toggl/state.db`

// Sentinel bucket labels surfaced as `client` / `project` / `task` values
// when the join path produces a partial match. Stable strings — tests
// pin them byte-exact, the bar's --unmapped pill mirrors the first.
const UNMAPPED = "(unmapped)"
const NO_LOCAL_CAPTURE = "(no-local-capture)"

// --------------------------------------------------------------------------
// Options + arg parsing
// --------------------------------------------------------------------------

export type GroupBy = "task" | "project" | "client"
export type Format = "json" | "csv" | "table"

export type ByTogglOptions = {
  groupBy: GroupBy
  since?: string                // YYYY-MM-DD; filters zen_usage.time_created
  until?: string                // YYYY-MM-DD; inclusive upper bound
  togglDb: string               // path to the toggl state DB; ATTACHed as `toggl`
  includeUnmapped: boolean      // default: true
  includeUnattributed: boolean  // default: true
  noModelSplit: boolean         // drop `model` from GROUP BY and column set
  format: Format
}

type ArgsResult =
  | { ok: true; opts: ByTogglOptions }
  | { ok: false; error: string }

const parseArgs = (argv: string[]): ArgsResult => {
  let groupBy: GroupBy | undefined
  let since: string | undefined
  let until: string | undefined
  let togglDb: string = resolveDefaultTogglDb()
  let includeUnmapped = true
  let includeUnattributed = true
  let noModelSplit = false
  let format: Format | undefined

  const isGroup = (v: string): v is GroupBy =>
    v === "task" || v === "project" || v === "client"

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--group-by") {
      const v = argv[++i]
      if (v === undefined) {
        return { ok: false, error: "--group-by requires a value (task|project|client)" }
      }
      if (!isGroup(v)) {
        return { ok: false, error: `--group-by must be one of task|project|client (got "${v}")` }
      }
      groupBy = v
    } else if (a.startsWith("--group-by=")) {
      const v = a.slice("--group-by=".length)
      if (!isGroup(v)) {
        return { ok: false, error: `--group-by must be one of task|project|client (got "${v}")` }
      }
      groupBy = v
    } else if (a === "--since") {
      const v = argv[++i]
      if (v === undefined) return { ok: false, error: "--since requires a date argument" }
      since = v
    } else if (a.startsWith("--since=")) {
      since = a.slice("--since=".length)
    } else if (a === "--until") {
      const v = argv[++i]
      if (v === undefined) return { ok: false, error: "--until requires a date argument" }
      until = v
    } else if (a.startsWith("--until=")) {
      until = a.slice("--until=".length)
    } else if (a === "--toggl-db") {
      const v = argv[++i]
      if (v === undefined) return { ok: false, error: "--toggl-db requires a path argument" }
      togglDb = v
    } else if (a.startsWith("--toggl-db=")) {
      togglDb = a.slice("--toggl-db=".length)
    } else if (a === "--include-unmapped") {
      includeUnmapped = true
    } else if (a === "--no-include-unmapped") {
      includeUnmapped = false
    } else if (a === "--include-unattributed") {
      includeUnattributed = true
    } else if (a === "--no-include-unattributed") {
      includeUnattributed = false
    } else if (a === "--no-model-split") {
      noModelSplit = true
    } else if (a === "--json" || a === "--csv" || a === "--table") {
      const f = a.slice(2) as Format
      if (format !== undefined && format !== f) {
        return { ok: false, error: "--json, --csv, and --table are mutually exclusive" }
      }
      format = f
    } else {
      return { ok: false, error: `unknown argument: ${a}` }
    }
  }

  if (groupBy === undefined) {
    return {
      ok: false,
      error: "--group-by is required (one of task|project|client)",
    }
  }
  for (const [name, value] of [["since", since], ["until", until]] as const) {
    if (value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return { ok: false, error: `--${name} must be YYYY-MM-DD (got "${value}")` }
    }
  }
  return {
    ok: true,
    opts: {
      groupBy,
      since,
      until,
      togglDb,
      includeUnmapped,
      includeUnattributed,
      noModelSplit,
      format: format ?? "table",
    },
  }
}

// --------------------------------------------------------------------------
// Row shape + SQL builder
// --------------------------------------------------------------------------

/**
 * One aggregated row coming off the SQL. INTEGER fxp8 throughout — the
 * §10.1.d invariant 4 mandate. Display-side formatters divide by 1e8
 * only at the very end. `project` and `task` are non-null in the
 * §10.1.e bucket-labelled rows too — we substitute the sentinels at
 * the SQL layer so callers downstream don't have to special-case NULLs.
 */
export type AggregatedRow = {
  client: string
  project: string | null   // null only when grouping by client
  task: string | null      // null when grouping by client or project
  model: string | null     // null when --no-model-split
  cost_fxp8: number
}

export type AggregateOptions = {
  groupBy: GroupBy
  since?: string
  until?: string
  includeUnmapped: boolean
  includeUnattributed: boolean
  noModelSplit: boolean
}

/**
 * Build the SQL for the rollup query. The query expects `toggl.toggl_repo_state`
 * to be available via an ATTACH'd database aliased `toggl` — callers must
 * ATTACH before invoking. Bound parameters:
 *   :since  — YYYY-MM-DD lower bound (inclusive) on zen_usage.time_created;
 *             empty string disables.
 *   :until  — YYYY-MM-DD upper bound (inclusive); empty string disables.
 *
 * Construction notes:
 *   1. A `session_to_worktree` CTE collapses messages.session_id → one
 *      worktree_path via MIN(). This avoids the multiplicative join
 *      problem when a session has many messages all in the same
 *      worktree (real case). Deterministic per §14 open item 1.
 *   2. Three bucket SELECTs are UNION ALL'd into `all_rows`. Each
 *      bucket guarantees exclusive membership via the LEFT JOIN ...
 *      IS NULL idiom — no zen_usage row contributes to more than one
 *      bucket. §10.1.d invariant 2.
 *   3. Outer SELECT GROUP BYs the visible group columns plus model
 *      (unless --no-model-split). SUM(cost_fxp8) stays integer.
 *   4. ORDER BY cost_fxp8 DESC, then group cols ASC — same shape as
 *      the §10.2-§10.4 expected tables.
 */
const buildSql = (opts: AggregateOptions): string => {
  // GROUP BY / SELECT column list. Order matters — it shapes the row
  // output and the §10.2-§10.4 sort tiebreaker chain.
  const visibleCols: string[] = ["client"]
  if (opts.groupBy === "project" || opts.groupBy === "task") {
    visibleCols.push("project")
  }
  if (opts.groupBy === "task") {
    visibleCols.push("task")
  }
  if (!opts.noModelSplit) {
    visibleCols.push("model")
  }

  // For SELECT columns that aren't in GROUP BY, emit NULLs so the
  // returned row shape is stable across --group-by modes.
  const allCols = ["client", "project", "task", "model"]
  const selectCols = allCols.map((c) =>
    visibleCols.includes(c) ? c : `NULL AS ${c}`,
  )
  selectCols.push("SUM(cost_fxp8) AS cost_fxp8")

  // Sort: §10.1.f / §10.2-§10.4 — cost_usd DESC, group cols ASC.
  // (cost_fxp8 DESC is equivalent to cost_usd DESC because the
  // monotonic divide by 1e8 preserves order.)
  const orderBy = ["cost_fxp8 DESC", ...visibleCols.map((c) => `${c} ASC`)]

  const buckets: string[] = []

  // Bucket 1: mapped (zen → messages → toggl all match).
  buckets.push(`
    SELECT
      r.client_name  AS client,
      r.project_name AS project,
      r.task         AS task,
      zu.model       AS model,
      zu.cost_fxp8   AS cost_fxp8
    FROM zen_usage zu
    JOIN (SELECT session_id, MIN(worktree_path) AS worktree_path
          FROM messages
          GROUP BY session_id) sw
      ON sw.session_id = zu.session_id
    JOIN toggl.toggl_repo_state r
      ON r.worktree_path = sw.worktree_path
    WHERE (:since = '' OR substr(zu.time_created, 1, 10) >= :since)
      AND (:until = '' OR substr(zu.time_created, 1, 10) <= :until)
  `)

  if (opts.includeUnmapped) {
    // Bucket 2: zen → messages matches, no toggl_repo_state.
    buckets.push(`
      SELECT
        '${UNMAPPED}' AS client,
        '${UNMAPPED}' AS project,
        '${UNMAPPED}' AS task,
        zu.model AS model,
        zu.cost_fxp8 AS cost_fxp8
      FROM zen_usage zu
      JOIN (SELECT session_id, MIN(worktree_path) AS worktree_path
            FROM messages
            GROUP BY session_id) sw
        ON sw.session_id = zu.session_id
      LEFT JOIN toggl.toggl_repo_state r
        ON r.worktree_path = sw.worktree_path
      WHERE r.worktree_path IS NULL
        AND (:since = '' OR substr(zu.time_created, 1, 10) >= :since)
        AND (:until = '' OR substr(zu.time_created, 1, 10) <= :until)
    `)
  }

  if (opts.includeUnattributed) {
    // Bucket 3: zen with no matching messages row.
    buckets.push(`
      SELECT
        '${NO_LOCAL_CAPTURE}' AS client,
        '${NO_LOCAL_CAPTURE}' AS project,
        '${NO_LOCAL_CAPTURE}' AS task,
        zu.model AS model,
        zu.cost_fxp8 AS cost_fxp8
      FROM zen_usage zu
      LEFT JOIN (SELECT session_id
                 FROM messages
                 GROUP BY session_id) sw
        ON sw.session_id = zu.session_id
      WHERE sw.session_id IS NULL
        AND (:since = '' OR substr(zu.time_created, 1, 10) >= :since)
        AND (:until = '' OR substr(zu.time_created, 1, 10) <= :until)
    `)
  }

  const inner = buckets.join("\nUNION ALL\n")

  return `
    WITH all_rows AS (
      ${inner}
    )
    SELECT
      ${selectCols.join(",\n      ")}
    FROM all_rows
    GROUP BY ${visibleCols.join(", ")}
    ORDER BY ${orderBy.join(", ")}
  `
}

/**
 * Run the rollup against a DB that has toggl.toggl_repo_state ATTACHed
 * as `toggl`. Pure read; no writes. Returns `AggregatedRow[]` in the
 * §10.2-§10.4 byte-exact order.
 *
 * Exported separately from `runByToggl` so tests can drive the rollup
 * without going through the CLI entry / env vars / argv parser.
 */
export const aggregateByToggl = (
  db: Database,
  opts: AggregateOptions,
): AggregatedRow[] => {
  const sql = buildSql(opts)
  const rows = db.query(sql).all({
    ":since": opts.since ?? "",
    ":until": opts.until ?? "",
  }) as AggregatedRow[]
  return rows
}

// --------------------------------------------------------------------------
// Renderers
// --------------------------------------------------------------------------

// Two decimals for amounts ≥ $0.01; six decimals for sub-cent (gpt-5-nano
// can be a fraction of a cent per request). Same rule reconcile.ts uses
// — pennies for human eyes, microcents for the smallest models.
const fmtDollars = (fxp8: number): string => {
  const dollars = fxp8 / 1e8
  if (Math.abs(dollars) >= 0.01 || dollars === 0) {
    return `$${dollars.toFixed(2)}`
  }
  return `$${dollars.toFixed(6)}`
}

// Columns that show up in the rendered output, in order. The structured
// AggregatedRow always carries all four (client/project/task/model);
// only the ones the user actually grouped on (plus optional model)
// surface here. fxp8 stays INTEGER in JSON/CSV per §10.1.f.
const visibleColumns = (opts: ByTogglOptions): string[] => {
  const cols: string[] = ["client"]
  if (opts.groupBy === "project" || opts.groupBy === "task") cols.push("project")
  if (opts.groupBy === "task") cols.push("task")
  if (!opts.noModelSplit) cols.push("model")
  return cols
}

const writeJson = (rows: AggregatedRow[], opts: ByTogglOptions) => {
  const cols = visibleColumns(opts)
  const projected = rows.map((r) => {
    const out: Record<string, unknown> = {}
    for (const c of cols) out[c] = (r as Record<string, unknown>)[c]
    out.cost_fxp8 = r.cost_fxp8
    return out
  })
  process.stdout.write(JSON.stringify(projected))
  process.stdout.write("\n")
}

const csvEscape = (v: unknown): string => {
  if (v === null || v === undefined) return ""
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const writeCsv = (rows: AggregatedRow[], opts: ByTogglOptions) => {
  const cols = visibleColumns(opts)
  const headers = [...cols, "cost_fxp8"]
  process.stdout.write(headers.join(",") + "\n")
  for (const r of rows) {
    const cells = cols.map((c) => csvEscape((r as Record<string, unknown>)[c]))
    cells.push(String(r.cost_fxp8))
    process.stdout.write(cells.join(",") + "\n")
  }
}

const writeTable = (rows: AggregatedRow[], opts: ByTogglOptions) => {
  const cols = visibleColumns(opts)
  const headers = [...cols, "cost_usd"]
  const data = rows.map((r) => [
    ...cols.map((c) => String((r as Record<string, unknown>)[c] ?? "")),
    fmtDollars(r.cost_fxp8),
  ])
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...data.map((row) => row[i].length)),
  )
  // Left-justify all text columns; right-justify the cost column so
  // dollar signs line up cleanly when scanned by eye.
  const fmt = (cells: string[]): string =>
    cells
      .map((c, i) =>
        i === cells.length - 1 ? c.padStart(widths[i]) : c.padEnd(widths[i]),
      )
      .join("  ")

  process.stdout.write(fmt(headers) + "\n")
  process.stdout.write(widths.map((w) => "-".repeat(w)).join("  ") + "\n")
  for (const r of data) process.stdout.write(fmt(r) + "\n")

  if (rows.length === 0) {
    process.stdout.write(
      "\n(no rows — either zen_usage is empty for the window, " +
      "or all buckets were excluded via --no-include-* flags)\n",
    )
  }
}

// --------------------------------------------------------------------------
// CLI entry
// --------------------------------------------------------------------------

/**
 * `opencode-cost dump by-toggl` entry point. See module docblock for the
 * full §10.1.f surface. Returns 0 on success, 1 on read/query failure,
 * 2 on argument parse failure (and on toggl.db missing — locked
 * decision #8 makes this a non-zero exit).
 */
export const runByToggl = (argv: string[]): number => {
  const parsed = parseArgs(argv)
  if (!parsed.ok) {
    console.error(`opencode-cost: ${parsed.error}`)
    return 2
  }
  const opts = parsed.opts

  // PLAN §10.1.e edge case 5: toggl.db missing → fail loud with a
  // diagnostic pointing the operator at toggl-set. Locked decision #8
  // (PLAN §2 + §11.6) deliberately diverges from the tmux bar's
  // silent-degrade contract.
  if (!fs.existsSync(opts.togglDb)) {
    console.error(
      `opencode-cost: toggl.db not found at ${opts.togglDb}.\n` +
      `Run \`toggl-set\` in at least one worktree to create it, ` +
      `or pass --toggl-db <path> to point at an existing file.`,
    )
    return 2
  }

  const dbPath = resolveDbPath()
  let db: Database
  try {
    db = new Database(dbPath, { readonly: true })
  } catch (e: any) {
    console.error(`opencode-cost: cannot open ${dbPath} (${e?.message ?? e})`)
    console.error("opencode-cost: run an opencode session first to create the DB.")
    return 1
  }

  try {
    // ATTACH the toggl DB. Path must already exist (we checked above).
    // SQLite literal-quote the path; escape any embedded single quotes.
    const togglEsc = opts.togglDb.replace(/'/g, "''")
    try {
      db.exec(`ATTACH DATABASE '${togglEsc}' AS toggl`)
    } catch (e: any) {
      console.error(
        `opencode-cost: ATTACH DATABASE failed for ${opts.togglDb} ` +
        `(${e?.message ?? e}).\n` +
        `Run \`toggl-set\` in at least one worktree to (re)create it.`,
      )
      return 2
    }

    let rows: AggregatedRow[]
    try {
      rows = aggregateByToggl(db, opts)
    } catch (e: any) {
      console.error(`opencode-cost: by-toggl query failed (${e?.message ?? e})`)
      return 1
    }

    if (opts.format === "json") writeJson(rows, opts)
    else if (opts.format === "csv") writeCsv(rows, opts)
    else writeTable(rows, opts)
    return 0
  } finally {
    db.close()
  }
}

// --------------------------------------------------------------------------
// Companion: zen_usage / by-session-zen dumps (P5.5)
// --------------------------------------------------------------------------
//
// Both subcommands are simple reads on zen_usage (no toggl JOIN). They
// live here so the dispatch tree in bin/opencode-cost stays thin and
// callers can grep for "zen_usage" and find all of them.

type ZenUsageDumpOptions = {
  session?: string
  since?: string
  format: Format
}

const parseZenUsageDumpArgs = (
  argv: string[],
): { ok: true; opts: ZenUsageDumpOptions } | { ok: false; error: string } => {
  let session: string | undefined
  let since: string | undefined
  let format: Format | undefined

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--session") {
      const v = argv[++i]
      if (v === undefined) return { ok: false, error: "--session requires a value" }
      session = v
    } else if (a.startsWith("--session=")) {
      session = a.slice("--session=".length)
    } else if (a === "--since") {
      const v = argv[++i]
      if (v === undefined) return { ok: false, error: "--since requires a date argument" }
      since = v
    } else if (a.startsWith("--since=")) {
      since = a.slice("--since=".length)
    } else if (a === "--json" || a === "--csv" || a === "--table") {
      const f = a.slice(2) as Format
      if (format !== undefined && format !== f) {
        return { ok: false, error: "--json, --csv, and --table are mutually exclusive" }
      }
      format = f
    } else {
      return { ok: false, error: `unknown argument: ${a}` }
    }
  }
  if (since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    return { ok: false, error: `--since must be YYYY-MM-DD (got "${since}")` }
  }
  return { ok: true, opts: { session, since, format: format ?? "table" } }
}

/**
 * `opencode-cost dump zen-usage [--session ses_xxx] [--since YYYY-MM-DD]
 *  [--json|--csv|--table]` — direct read of `zen_usage`.
 *
 * Default --table is whitespace-aligned for human eyes. --json keeps
 * the schema raw (fxp8 INTEGER columns; ISO timestamps; enrichment_json
 * is the stringified row of forward-compat enrichment).
 */
export const runDumpZenUsage = (argv: string[]): number => {
  const parsed = parseZenUsageDumpArgs(argv)
  if (!parsed.ok) {
    console.error(`opencode-cost: ${parsed.error}`)
    return 2
  }
  const { session, since, format } = parsed.opts

  const dbPath = resolveDbPath()
  let db: Database
  try {
    db = new Database(dbPath, { readonly: true })
  } catch (e: any) {
    console.error(`opencode-cost: cannot open ${dbPath} (${e?.message ?? e})`)
    return 1
  }

  try {
    const where: string[] = []
    const params: Record<string, string> = {}
    if (session !== undefined) {
      where.push("session_id = :session")
      params[":session"] = session
    }
    if (since !== undefined) {
      where.push("substr(time_created, 1, 10) >= :since")
      params[":since"] = since
    }
    const sql = `
      SELECT id, workspace_id, session_id, key_id, model, provider,
             time_created, time_updated, time_deleted,
             input_tokens, output_tokens, reasoning_tokens,
             cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens,
             cost_fxp8, enrichment_json, fetched_at
      FROM zen_usage
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY time_created
    `
    const rows = (
      Object.keys(params).length === 0
        ? db.query(sql).all()
        : db.query(sql).all(params)
    ) as Record<string, unknown>[]

    if (format === "json") {
      process.stdout.write(JSON.stringify(rows))
      process.stdout.write("\n")
    } else if (format === "csv") {
      const headers = rows.length > 0
        ? Object.keys(rows[0])
        : [
            "id", "workspace_id", "session_id", "key_id", "model", "provider",
            "time_created", "time_updated", "time_deleted",
            "input_tokens", "output_tokens", "reasoning_tokens",
            "cache_read_tokens", "cache_write_5m_tokens", "cache_write_1h_tokens",
            "cost_fxp8", "enrichment_json", "fetched_at",
          ]
      process.stdout.write(headers.join(",") + "\n")
      for (const r of rows) {
        process.stdout.write(
          headers.map((h) => csvEscape(r[h])).join(",") + "\n",
        )
      }
    } else {
      // table — simple whitespace-aligned, no fancy formatting.
      const headers = rows.length > 0
        ? Object.keys(rows[0])
        : ["id", "session_id", "model", "time_created", "cost_fxp8"]
      const data = rows.map((r) =>
        headers.map((h) => (r[h] === null || r[h] === undefined ? "" : String(r[h]))),
      )
      const widths = headers.map((h, i) =>
        Math.max(h.length, ...data.map((row) => row[i].length)),
      )
      const fmt = (cells: string[]): string =>
        cells.map((c, i) => c.padEnd(widths[i])).join("  ")
      process.stdout.write(fmt(headers) + "\n")
      process.stdout.write(widths.map((w) => "-".repeat(w)).join("  ") + "\n")
      for (const r of data) process.stdout.write(fmt(r) + "\n")
    }
    return 0
  } catch (e: any) {
    console.error(`opencode-cost: zen-usage query failed (${e?.message ?? e})`)
    return 1
  } finally {
    db.close()
  }
}

type BySessionZenDumpOptions = {
  since?: string
  format: Format
}

const parseBySessionZenArgs = (
  argv: string[],
): { ok: true; opts: BySessionZenDumpOptions } | { ok: false; error: string } => {
  let since: string | undefined
  let format: Format | undefined

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--since") {
      const v = argv[++i]
      if (v === undefined) return { ok: false, error: "--since requires a date argument" }
      since = v
    } else if (a.startsWith("--since=")) {
      since = a.slice("--since=".length)
    } else if (a === "--json" || a === "--csv" || a === "--table") {
      const f = a.slice(2) as Format
      if (format !== undefined && format !== f) {
        return { ok: false, error: "--json, --csv, and --table are mutually exclusive" }
      }
      format = f
    } else {
      return { ok: false, error: `unknown argument: ${a}` }
    }
  }
  if (since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    return { ok: false, error: `--since must be YYYY-MM-DD (got "${since}")` }
  }
  return { ok: true, opts: { since, format: format ?? "table" } }
}

/**
 * `opencode-cost dump by-session-zen [--since YYYY-MM-DD]
 *  [--json|--csv|--table]` — totals from zen_usage grouped by session.
 *
 * Surfaces session-level Zen ground truth without the toggl JOIN.
 * Useful for spot-checks against TUI session totals during reconcile.
 */
export const runDumpBySessionZen = (argv: string[]): number => {
  const parsed = parseBySessionZenArgs(argv)
  if (!parsed.ok) {
    console.error(`opencode-cost: ${parsed.error}`)
    return 2
  }
  const { since, format } = parsed.opts

  const dbPath = resolveDbPath()
  let db: Database
  try {
    db = new Database(dbPath, { readonly: true })
  } catch (e: any) {
    console.error(`opencode-cost: cannot open ${dbPath} (${e?.message ?? e})`)
    return 1
  }

  try {
    const where = since !== undefined
      ? "WHERE substr(time_created, 1, 10) >= :since"
      : ""
    const sql = `
      SELECT
        session_id,
        model,
        COUNT(*) AS rows_n,
        MIN(time_created) AS first_seen,
        MAX(time_created) AS last_seen,
        SUM(cost_fxp8) AS cost_fxp8,
        SUM(input_tokens) AS input_tokens,
        SUM(output_tokens) AS output_tokens,
        SUM(cache_read_tokens) AS cache_read_tokens,
        SUM(cache_write_5m_tokens) AS cache_write_5m_tokens,
        SUM(cache_write_1h_tokens) AS cache_write_1h_tokens
      FROM zen_usage
      ${where}
      GROUP BY session_id, model
      ORDER BY cost_fxp8 DESC, session_id, model
    `
    const rows = (
      since !== undefined
        ? db.query(sql).all({ ":since": since })
        : db.query(sql).all()
    ) as Record<string, unknown>[]

    if (format === "json") {
      process.stdout.write(JSON.stringify(rows))
      process.stdout.write("\n")
    } else if (format === "csv") {
      const headers = [
        "session_id", "model", "rows_n", "first_seen", "last_seen",
        "cost_fxp8", "input_tokens", "output_tokens", "cache_read_tokens",
        "cache_write_5m_tokens", "cache_write_1h_tokens",
      ]
      process.stdout.write(headers.join(",") + "\n")
      for (const r of rows) {
        process.stdout.write(headers.map((h) => csvEscape(r[h])).join(",") + "\n")
      }
    } else {
      const headers = [
        "session_id", "model", "rows", "first_seen", "last_seen", "cost_$",
      ]
      const data = rows.map((r) => [
        String(r.session_id ?? ""),
        String(r.model ?? ""),
        String(r.rows_n ?? 0),
        String(r.first_seen ?? ""),
        String(r.last_seen ?? ""),
        fmtDollars(Number(r.cost_fxp8 ?? 0)),
      ])
      const widths = headers.map((h, i) =>
        Math.max(h.length, ...data.map((row) => row[i].length)),
      )
      const fmt = (cells: string[]): string =>
        cells
          .map((c, i) => (i === cells.length - 1 ? c.padStart(widths[i]) : c.padEnd(widths[i])))
          .join("  ")
      process.stdout.write(fmt(headers) + "\n")
      process.stdout.write(widths.map((w) => "-".repeat(w)).join("  ") + "\n")
      for (const r of data) process.stdout.write(fmt(r) + "\n")
    }
    return 0
  } catch (e: any) {
    console.error(`opencode-cost: by-session-zen query failed (${e?.message ?? e})`)
    return 1
  } finally {
    db.close()
  }
}
