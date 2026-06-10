// opencode-cost/import-opencode.ts — backfill `messages` and
// `session_rollup` in ~/.local/state/opencode-cost.db from opencode's
// own ~/.local/share/opencode/opencode.db.
//
// Design and rationale:
//   ../../../../docs/archive/opencode/PLAN-cost-pertask-tmux-status.md §9 Commit 2
//   ../../../../docs/archive/opencode/PLAN-cost-tracker.md §6 Phase 5
//
// Phase ownership of this file:
//   Commit 2 of the per-task PLAN (Phase 5 of the cost-tracker PLAN) —
//     read opencode's `part` table for rows with `type='step-finish'`,
//     join to `message` and `session` for context (modelID, providerID,
//     timestamps, directory), and `INSERT OR IGNORE` into our `messages`
//     keyed by `message_id`. The OR IGNORE keeps the plugin's native
//     captures authoritative for rows it already wrote — backfill only
//     fills the gaps. After insertion, recompute `session_rollup` for
//     every touched session via INSERT OR REPLACE.
//
// Extraction shape (confirmed against ~/.local/share/opencode/opencode.db
// 2026-05-19; see PLAN §9 P2.0):
//
//   part.data JSON for type='step-finish':
//     { reason, snapshot, type: "step-finish",
//       tokens: { total, input, output, reasoning,
//                 cache: { read, write } },
//       cost: <number, raw USD> }
//
//   message.data JSON for role='assistant' (joined via part.message_id):
//     { id?, parentID?, role: "assistant", mode?, agent?,
//       path: { cwd, root },
//       cost: <number>, tokens: { ... },
//       modelID, providerID,
//       time: { created: <epoch_ms>, completed?: <epoch_ms> },
//       finish? }
//
//   session.directory holds the cwd at session creation (the part also
//   carries it as `path.cwd`; we prefer session.directory because that's
//   the value the plugin's `worktree` arg derives from on live sessions).
//
//   Each assistant message has exactly one step-finish part (verified:
//   11742 step-finish rows, 11742 distinct message_ids on the live DB).
//   No de-dup math needed across multiple step-finish parts per message.
//
// Cost arithmetic mirrors the live plugin (plugins/cost-tracker.ts):
//   cost_opencode_fxp8 = Math.round(part.cost * 1e8)
//   cost_recomputed_fxp8 = recompute(rate, tokens)   // see recompute.ts
//
// Idempotency contract:
//   - `messages` uses INSERT OR IGNORE keyed by `message_id`. Plugin
//     rows take precedence; backfill only fills gaps. Re-running the
//     subcommand is safe and produces zero net writes on stable DBs.
//   - `session_rollup` uses INSERT OR REPLACE keyed by `session_id` and
//     is recomputed from the post-insert `messages` SUM, so it always
//     reflects the truthful aggregate.
//
// `--reconcile` mode reports the drift between
//   SUM(messages.cost_opencode_fxp8) GROUP BY date,model
//   SUM(zen_daily_billed.total_cost_fxp8) GROUP BY date,model
// for the same `--since` window. The cost-tracker PLAN §2 documents
// "a few %" as the expected drift floor (tier crossings, cache TTL
// collapse, etc.) — anything substantially above that signals a
// missed-messages bug or a stale rate table.

import fs from "node:fs"
import { Database } from "bun:sqlite"
import { recompute, type Tokens } from "../plugins/cost-tracker/recompute.ts"
import type { Rate, RateTable } from "../plugins/cost-tracker/rate-table.ts"

// --------------------------------------------------------------------------
// Defaults and arg parsing
// --------------------------------------------------------------------------

const HOME = process.env.HOME ?? "/root"
const COST_DB_PATH =
  process.env.OPENCODE_COST_DB ?? `${HOME}/.local/state/opencode-cost.db`
const OPENCODE_DB_PATH =
  process.env.OPENCODE_SOURCE_DB ?? `${HOME}/.local/share/opencode/opencode.db`

type ImportOptions = {
  since?: string // YYYY-MM-DD (filters opencode.db candidates by m.time_created)
  dryRun: boolean
  reconcile: boolean
}

type ArgsResult =
  | { ok: true; opts: ImportOptions }
  | { ok: false; error: string }

const parseArgs = (argv: string[]): ArgsResult => {
  let since: string | undefined
  let dryRun = false
  let reconcile = false

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--dry-run") {
      dryRun = true
    } else if (a === "--reconcile") {
      reconcile = true
    } else if (a === "--since") {
      const v = argv[++i]
      if (v === undefined)
        return { ok: false, error: "--since requires a YYYY-MM-DD argument" }
      since = v
    } else if (a.startsWith("--since=")) {
      since = a.slice("--since=".length)
    } else if (a === "-h" || a === "--help" || a === "help") {
      return { ok: false, error: "__help__" }
    } else {
      return { ok: false, error: `unknown argument: ${a}` }
    }
  }

  if (since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    return { ok: false, error: `--since must be YYYY-MM-DD (got "${since}")` }
  }

  return { ok: true, opts: { since, dryRun, reconcile } }
}

const usage = `opencode-cost import-opencode — backfill messages from opencode.db

usage:
  opencode-cost import-opencode [--since YYYY-MM-DD] [--dry-run] [--reconcile]

reads:
  ~/.local/share/opencode/opencode.db          (READ-ONLY; override via OPENCODE_SOURCE_DB)

writes:
  ~/.local/state/opencode-cost.db              (override via OPENCODE_COST_DB)

flags:
  --since YYYY-MM-DD   only consider messages created on or after this date
                       (filters opencode.db's message.time_created)
  --dry-run            report counts only; no writes
  --reconcile          after insert (or skipped in --dry-run), print a
                       per-(date, model) drift report between
                       messages.cost_opencode_fxp8 and
                       zen_daily_billed.total_cost_fxp8 for the same window.

The OR IGNORE semantics on messages.message_id means the plugin's native
captures are preserved; backfill only fills the historical gap.
`

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

type CandidateRow = {
  message_id: string
  session_id: string
  msg_data: string
  part_data: string
  directory: string
  msg_time_created: number // epoch ms (for ordering / since-filter sanity)
}

type ParsedCandidate = {
  message_id: string
  session_id: string
  worktree_path: string
  provider_id: string
  model_id: string
  agent: string | null
  ts_created: string
  ts_completed: string | null
  tokens: Tokens
  cost_opencode_fxp8: number
  finish: string | null
  raw_json: string
}

type ImportStats = {
  candidates_scanned: number
  candidates_parsed: number
  candidates_skipped: number
  inserted: number
  ignored_existing: number
  sessions_touched: number
  missing_rates: Map<string, number> // rateKey → count
  per_day_per_model: Map<string, { rows: number; cost_fxp8: number }>
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

// Convert opencode's epoch-ms NUMBER timestamps to ISO 8601 strings the
// `messages` schema expects (ts_created TEXT NOT NULL, ts_completed TEXT).
// Returns null on non-finite input; the caller decides if null is OK for
// that column.
const epochMsToIso = (n: unknown): string | null => {
  if (typeof n !== "number" || !Number.isFinite(n)) return null
  return new Date(n).toISOString()
}

// Best-effort realpath. Historical sessions may reference worktrees that
// have been removed since the message was recorded; in that case fall
// back to the raw path so the row still inserts (the schema declares
// worktree_path NOT NULL). Live captures via the plugin run
// `realpathSync` against an extant path, so most stored worktree_paths
// are already realpath'd — repeating it here keeps the two writers
// producing the same string for the same directory.
const resolveWorktreePath = (raw: string): string => {
  if (!raw) return ""
  try {
    return fs.realpathSync(raw)
  } catch {
    return raw
  }
}

const loadCurrentRates = (costDb: Database): RateTable => {
  let row: { rate_version: string; payload_json: string } | null = null
  try {
    row = costDb
      .query(
        `SELECT rate_version, payload_json
         FROM provider_rates
         ORDER BY fetched_at DESC
         LIMIT 1`,
      )
      .get() as { rate_version: string; payload_json: string } | null
  } catch (e: any) {
    console.warn(
      `[import-opencode] cannot read provider_rates (${e?.message ?? e}); ` +
        `cost_recomputed_fxp8 will be 0 for backfilled rows`,
    )
    return { rate_version: "no-rates", rates: {} }
  }

  if (!row) {
    console.warn(
      "[import-opencode] no provider_rates snapshot found; " +
        "cost_recomputed_fxp8 will be 0 for backfilled rows. " +
        "Run opencode once so the plugin fetches a rate snapshot, " +
        "then re-run.",
    )
    return { rate_version: "no-rates", rates: {} }
  }

  let rates: Record<string, Rate>
  try {
    rates = JSON.parse(row.payload_json)
  } catch (e: any) {
    console.warn(
      `[import-opencode] provider_rates.payload_json is not parseable JSON ` +
        `(${e?.message ?? e}); cost_recomputed_fxp8 will be 0`,
    )
    return { rate_version: row.rate_version, rates: {} }
  }

  return { rate_version: row.rate_version, rates }
}

const parseCandidate = (raw: CandidateRow): ParsedCandidate | null => {
  let msg: any
  let part: any
  try {
    msg = JSON.parse(raw.msg_data)
    part = JSON.parse(raw.part_data)
  } catch {
    return null
  }

  // Defensive: schema columns are NOT NULL — drop rows that can't be
  // reconstructed cleanly rather than failing the whole import. The
  // outer stats counter logs how many were skipped so the user can
  // investigate if the count surprises them.
  const providerId = typeof msg.providerID === "string" ? msg.providerID : ""
  const modelId = typeof msg.modelID === "string" ? msg.modelID : ""
  if (!providerId || !modelId) return null

  // Prefer session.directory (canonical "where opencode is running") over
  // msg.path.cwd; for live captures these align, but session.directory is
  // the one the plugin's `worktree` arg comes from.
  const worktreePath = resolveWorktreePath(raw.directory)

  const tokens: Tokens = {
    input: part?.tokens?.input ?? msg?.tokens?.input ?? 0,
    output: part?.tokens?.output ?? msg?.tokens?.output ?? 0,
    reasoning: part?.tokens?.reasoning ?? msg?.tokens?.reasoning ?? 0,
    cache_read:
      part?.tokens?.cache?.read ?? msg?.tokens?.cache?.read ?? 0,
    cache_write:
      part?.tokens?.cache?.write ?? msg?.tokens?.cache?.write ?? 0,
  }

  const tsCreated =
    epochMsToIso(msg?.time?.created) ??
    epochMsToIso(raw.msg_time_created) ??
    new Date().toISOString()
  const tsCompleted = epochMsToIso(msg?.time?.completed)

  // Pre-fix step-finish row carries the canonical cost snapshot; the
  // message-level cost is the same value (verified for 5/5 sample rows
  // on the live DB). Fall back to message-level if part.cost is missing.
  const costRaw =
    typeof part?.cost === "number"
      ? part.cost
      : typeof msg?.cost === "number"
        ? msg.cost
        : 0
  const cost_opencode_fxp8 = Math.round(costRaw * 1e8)

  // raw_json keeps a 10KB-capped snapshot of the source for replay if
  // the recompute math is ever fixed retroactively (PLAN.md §3
  // reconciliation model). Combine message + part data so we don't lose
  // either side.
  const combined = JSON.stringify({ message: msg, part })
  const raw_json = combined.length > 10000 ? combined.slice(0, 10000) : combined

  return {
    message_id: raw.message_id,
    session_id: raw.session_id,
    worktree_path: worktreePath,
    provider_id: providerId,
    model_id: modelId,
    agent: msg?.agent ?? msg?.mode ?? null,
    ts_created: tsCreated,
    ts_completed: tsCompleted,
    tokens,
    cost_opencode_fxp8,
    finish: msg?.finish ?? part?.reason ?? null,
    raw_json,
  }
}

// --------------------------------------------------------------------------
// Reconcile printer (subset of dump reconciliation, scoped to messages
// just imported / present)
// --------------------------------------------------------------------------

type ReconcileRow = {
  date: string
  model: string
  messages_fxp8: number | null
  zen_fxp8: number | null
  drift_fxp8: number | null
  drift_pct: number | null
}

const fmtDollars = (fxp8: number | null): string => {
  if (fxp8 === null || fxp8 === undefined) return ""
  const d = fxp8 / 1e8
  if (Math.abs(d) >= 0.01 || d === 0) return d.toFixed(2)
  return d.toFixed(6)
}

const fmtSignedDollars = (fxp8: number | null): string => {
  if (fxp8 === null || fxp8 === undefined) return ""
  const s = fmtDollars(fxp8)
  return fxp8 > 0 && !s.startsWith("+") ? `+${s}` : s
}

const fmtSignedPct = (pct: number | null): string => {
  if (pct === null) return ""
  const s = `${pct.toFixed(1)}%`
  return pct > 0 && !s.startsWith("+") ? `+${s}` : s
}

const runReconcileReport = (
  costDb: Database,
  since: string | undefined,
): void => {
  const sql = `
    WITH local AS (
      SELECT
        substr(ts_created, 1, 10) AS date,
        model_id                  AS model,
        SUM(cost_opencode_fxp8)   AS local_fxp8
      FROM messages
      WHERE (:since = '' OR substr(ts_created, 1, 10) >= :since)
      GROUP BY date, model
    ),
    zen AS (
      SELECT
        date,
        model,
        SUM(total_cost_fxp8) AS zen_fxp8
      FROM zen_daily_billed
      WHERE (:since = '' OR date >= :since)
      GROUP BY date, model
    )
    SELECT
      COALESCE(l.date, z.date)   AS date,
      COALESCE(l.model, z.model) AS model,
      l.local_fxp8               AS messages_fxp8,
      z.zen_fxp8                 AS zen_fxp8
    FROM local l
    LEFT JOIN zen z USING (date, model)

    UNION

    SELECT
      COALESCE(l.date, z.date)   AS date,
      COALESCE(l.model, z.model) AS model,
      l.local_fxp8               AS messages_fxp8,
      z.zen_fxp8                 AS zen_fxp8
    FROM zen z
    LEFT JOIN local l USING (date, model)

    ORDER BY date DESC, model;
  `

  let rows: Array<{
    date: string
    model: string
    messages_fxp8: number | null
    zen_fxp8: number | null
  }>
  try {
    rows = costDb.query(sql).all({ ":since": since ?? "" }) as typeof rows
  } catch (e: any) {
    console.error(
      `[import-opencode] reconcile query failed (${e?.message ?? e})`,
    )
    return
  }

  // Decorate with drift columns.
  const decorated: ReconcileRow[] = rows.map((r) => {
    const m = r.messages_fxp8 ?? 0
    const z = r.zen_fxp8 ?? 0
    const drift = m - z
    const pct = z !== 0 ? (drift / z) * 100 : null
    return {
      date: r.date,
      model: r.model,
      messages_fxp8: r.messages_fxp8,
      zen_fxp8: r.zen_fxp8,
      drift_fxp8: r.messages_fxp8 === null && r.zen_fxp8 === null ? null : drift,
      drift_pct: pct,
    }
  })

  // Aggregate totals so the human can eyeball overall drift in one line.
  let totalLocal = 0
  let totalZen = 0
  for (const r of decorated) {
    totalLocal += r.messages_fxp8 ?? 0
    totalZen += r.zen_fxp8 ?? 0
  }
  const totalDrift = totalLocal - totalZen
  const totalPct = totalZen !== 0 ? (totalDrift / totalZen) * 100 : null

  const headers = [
    "date",
    "model",
    "messages_$",
    "zen_billed_$",
    "drift_$",
    "drift_%",
  ]
  const data = decorated.map((r) => [
    r.date,
    r.model,
    fmtDollars(r.messages_fxp8),
    fmtDollars(r.zen_fxp8),
    fmtSignedDollars(r.drift_fxp8),
    fmtSignedPct(r.drift_pct),
  ])

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...data.map((r) => r[i].length)),
  )
  const fmt = (cells: string[]) =>
    cells
      .map((c, i) =>
        i < 2 ? c.padEnd(widths[i]) : c.padStart(widths[i]),
      )
      .join("  ")

  process.stdout.write("\n-- reconcile report (messages vs zen_daily_billed) --\n")
  process.stdout.write(fmt(headers) + "\n")
  process.stdout.write(widths.map((w) => "-".repeat(w)).join("  ") + "\n")
  if (decorated.length === 0) {
    process.stdout.write("(no rows in either table for this window)\n")
  } else {
    for (const r of data) process.stdout.write(fmt(r) + "\n")
  }
  process.stdout.write("\n")
  process.stdout.write(
    `total: messages=${fmtDollars(totalLocal)}  zen=${fmtDollars(
      totalZen,
    )}  drift=${fmtSignedDollars(totalDrift)}  drift_pct=${fmtSignedPct(
      totalPct,
    )}\n`,
  )
  process.stdout.write(
    "drift budget per cost-tracker PLAN §2: a few % (pricing-table drift, " +
      "tier crossings, cache TTL collapse).\n",
  )
}

// --------------------------------------------------------------------------
// Entry
// --------------------------------------------------------------------------

export const runImportOpencode = (argv: string[]): number => {
  const parsed = parseArgs(argv)
  if (!parsed.ok) {
    if (parsed.error === "__help__") {
      process.stdout.write(usage)
      return 0
    }
    console.error(`opencode-cost: ${parsed.error}`)
    process.stderr.write(usage)
    return 2
  }
  const { since, dryRun, reconcile } = parsed.opts

  if (!fs.existsSync(OPENCODE_DB_PATH)) {
    console.error(
      `opencode-cost: source DB not found at ${OPENCODE_DB_PATH}.` +
        " Set OPENCODE_SOURCE_DB to override.",
    )
    return 1
  }

  // Cost DB: open writable unless --dry-run. Even in --dry-run we open
  // writable to read the latest rate table without locking concerns;
  // we just never call any of the INSERT statements.
  let costDb: Database
  try {
    costDb = new Database(COST_DB_PATH, { create: true })
  } catch (e: any) {
    console.error(
      `opencode-cost: cannot open cost DB ${COST_DB_PATH} (${e?.message ?? e})`,
    )
    return 1
  }

  let openDb: Database
  try {
    openDb = new Database(OPENCODE_DB_PATH, { readonly: true })
  } catch (e: any) {
    console.error(
      `opencode-cost: cannot open opencode DB ${OPENCODE_DB_PATH} (${e?.message ?? e})`,
    )
    costDb.close()
    return 1
  }

  // Statements (prepared once for the loop)
  const insertStmt = costDb.prepare(`
    INSERT OR IGNORE INTO messages (
      message_id, session_id, worktree_path, provider_id, model_id,
      agent, ts_created, ts_completed, tokens_input, tokens_output,
      tokens_reasoning, tokens_cache_read, tokens_cache_write,
      cost_opencode_fxp8, cost_recomputed_fxp8, rate_version, finish, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  // Recompute the rollup from the post-insert state so backfill + plugin
  // rows compose correctly. ts_last_idle uses MAX(ts_completed), falling
  // back to MAX(ts_created) when ts_completed is NULL for every row.
  const rollupStmt = costDb.prepare(`
    INSERT OR REPLACE INTO session_rollup (
      session_id, ts_last_idle, total_cost_opencode_fxp8,
      total_cost_recomputed_fxp8, message_count
    )
    SELECT
      session_id,
      COALESCE(MAX(ts_completed), MAX(ts_created)) AS ts_last_idle,
      COALESCE(SUM(cost_opencode_fxp8), 0)         AS total_opencode,
      COALESCE(SUM(cost_recomputed_fxp8), 0)       AS total_recomputed,
      COUNT(*)                                     AS msg_count
    FROM messages
    WHERE session_id = ?
    GROUP BY session_id
  `)

  // 1. Load rate table for the recompute step.
  const rateTable = loadCurrentRates(costDb)
  process.stdout.write(
    `[import-opencode] rate snapshot: ${rateTable.rate_version} ` +
      `(${Object.keys(rateTable.rates).length} models)\n`,
  )

  // 2. Pull candidates from opencode.db.
  let candidates: CandidateRow[]
  try {
    let sql = `
      SELECT
        m.id          AS message_id,
        m.session_id  AS session_id,
        m.data        AS msg_data,
        p.data        AS part_data,
        s.directory   AS directory,
        m.time_created AS msg_time_created
      FROM part p
      JOIN message m ON m.id = p.message_id
      JOIN session s ON s.id = m.session_id
      WHERE json_extract(p.data, '$.type') = 'step-finish'
        AND json_extract(m.data, '$.role') = 'assistant'
    `
    const params: any[] = []
    if (since) {
      sql += `
        AND DATE(m.time_created / 1000, 'unixepoch') >= ?
      `
      params.push(since)
    }
    sql += ` ORDER BY m.time_created`
    candidates = openDb.query(sql).all(...params) as CandidateRow[]
  } catch (e: any) {
    console.error(
      `[import-opencode] candidate query failed (${e?.message ?? e})`,
    )
    openDb.close()
    costDb.close()
    return 1
  }

  process.stdout.write(
    `[import-opencode] candidates: ${candidates.length}` +
      (since ? ` (since ${since})` : "") +
      "\n",
  )

  // 3. Parse, recompute, INSERT OR IGNORE.
  const stats: ImportStats = {
    candidates_scanned: candidates.length,
    candidates_parsed: 0,
    candidates_skipped: 0,
    inserted: 0,
    ignored_existing: 0,
    sessions_touched: 0,
    missing_rates: new Map(),
    per_day_per_model: new Map(),
  }
  const touchedSessions = new Set<string>()

  const doInserts = () => {
    for (const raw of candidates) {
      const c = parseCandidate(raw)
      if (!c) {
        stats.candidates_skipped += 1
        continue
      }
      stats.candidates_parsed += 1

      const rateKey = `${c.provider_id}/${c.model_id}`
      const rate = rateTable.rates[rateKey]
      if (!rate) {
        stats.missing_rates.set(
          rateKey,
          (stats.missing_rates.get(rateKey) ?? 0) + 1,
        )
      }
      const cost_recomputed_fxp8 = recompute(rate, c.tokens)

      // Aggregate stats by (date, model) for the summary print.
      const date = c.ts_created.slice(0, 10)
      const key = `${date}|${c.model_id}`
      const cell = stats.per_day_per_model.get(key) ?? {
        rows: 0,
        cost_fxp8: 0,
      }
      cell.rows += 1
      cell.cost_fxp8 += c.cost_opencode_fxp8
      stats.per_day_per_model.set(key, cell)

      touchedSessions.add(c.session_id)

      if (dryRun) continue

      const info = insertStmt.run(
        c.message_id,
        c.session_id,
        c.worktree_path,
        c.provider_id,
        c.model_id,
        c.agent,
        c.ts_created,
        c.ts_completed,
        c.tokens.input,
        c.tokens.output,
        c.tokens.reasoning,
        c.tokens.cache_read,
        c.tokens.cache_write,
        c.cost_opencode_fxp8,
        cost_recomputed_fxp8,
        rateTable.rate_version,
        c.finish,
        c.raw_json,
      )
      if (info.changes > 0) stats.inserted += 1
      else stats.ignored_existing += 1
    }
  }

  // Wrap the insert loop in a single transaction so a 10K-row backfill
  // doesn't fsync 10K times. The session_rollup recompute happens after
  // the inserts commit so the rollup queries see the final state.
  try {
    if (dryRun) {
      doInserts()
    } else {
      costDb.transaction(doInserts)()
    }
  } catch (e: any) {
    console.error(
      `[import-opencode] insert transaction failed (${e?.message ?? e})`,
    )
    openDb.close()
    costDb.close()
    return 1
  }

  // 4. Recompute session_rollup for every touched session (post-insert,
  //    so cost_opencode_fxp8 and cost_recomputed_fxp8 already reflect
  //    both backfilled and plugin-native rows).
  if (!dryRun) {
    try {
      costDb.transaction(() => {
        for (const sid of touchedSessions) {
          rollupStmt.run(sid)
        }
      })()
      stats.sessions_touched = touchedSessions.size
    } catch (e: any) {
      console.error(
        `[import-opencode] session_rollup recompute failed (${e?.message ?? e})`,
      )
      // Continue — inserts already landed; the user can re-run with
      // --reconcile to see what made it in.
    }
  } else {
    stats.sessions_touched = touchedSessions.size
  }

  // 5. Summary.
  const mode = dryRun ? "DRY RUN" : "applied"
  process.stdout.write(
    `\n[import-opencode] ${mode}:\n` +
      `  candidates scanned : ${stats.candidates_scanned}\n` +
      `  candidates parsed  : ${stats.candidates_parsed}\n` +
      `  candidates skipped : ${stats.candidates_skipped}\n` +
      `  inserted           : ${stats.inserted}${dryRun ? " (would insert)" : ""}\n` +
      `  ignored (existed)  : ${stats.ignored_existing}\n` +
      `  sessions affected  : ${stats.sessions_touched}\n`,
  )
  if (stats.missing_rates.size > 0) {
    process.stdout.write(
      `  missing rates      : ${stats.missing_rates.size} unique provider/model keys\n`,
    )
    for (const [key, count] of stats.missing_rates) {
      process.stdout.write(`      ${key}: ${count} messages\n`)
    }
  }

  // Per-day summary (last 7 distinct days) — quick eyeball before
  // running --reconcile separately.
  const days = Array.from(
    new Set(
      Array.from(stats.per_day_per_model.keys()).map((k) => k.split("|")[0]),
    ),
  ).sort()
  const tailDays = days.slice(-7)
  if (tailDays.length > 0) {
    process.stdout.write(
      `\n  per-day cost (messages.cost_opencode_fxp8, last ${tailDays.length} days):\n`,
    )
    for (const day of tailDays) {
      let total = 0
      let rows = 0
      for (const [key, v] of stats.per_day_per_model) {
        if (key.startsWith(`${day}|`)) {
          total += v.cost_fxp8
          rows += v.rows
        }
      }
      process.stdout.write(
        `      ${day}: ${fmtDollars(total).padStart(10)}  (${rows} messages)\n`,
      )
    }
  }
  process.stdout.write("\n")

  // 6. Optional reconcile report.
  if (reconcile) {
    runReconcileReport(costDb, since)
  }

  openDb.close()
  costDb.close()
  return 0
}
