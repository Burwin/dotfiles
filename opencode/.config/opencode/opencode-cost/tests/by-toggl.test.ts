// opencode-cost/tests/by-toggl.test.ts — §10 acceptance tests for the
// `dump by-toggl` rollup (Z5 of the per-task PLAN).
//
// Acceptance contract:
//   ../../../../docs/plans/opencode-cost-pertask-tmux-status/PLAN.md
//   §10.1 (shared fixture, join path, invariants, edge cases, CLI surface)
//   §10.2 per-client rollup
//   §10.3 per-project rollup
//   §10.4 per-task rollup
//   §10.5 test fixture implementation
//
// Status: GREEN against Commit 5's implementation.
//
// Fixture lives entirely in :memory: SQLite (per §10.1.a / §10.1.b /
// §10.5). For the `--toggl-db` ATTACH path we still need a real file
// (SQLite ATTACH won't share a `:memory:` handle across Database
// instances), so we write the toggl rows to a tmp file per-test. The
// opencode-cost.db (the host of the messages / zen_usage tables) is
// constructed in :memory: and we ATTACH the toggl tmpfile to it.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  aggregateByToggl,
  runByToggl,
  type AggregatedRow,
  type AggregateOptions,
  type GroupBy,
} from "../by-toggl.ts"

// --------------------------------------------------------------------------
// §10.1.a + §10.1.b shared fixture
// --------------------------------------------------------------------------
//
// Three toggl_repo_state rows + six messages rows (one per session) +
// seven zen_usage rows (one per messages session, plus one orphaned
// row with no matching messages session — the "unattributed" case).
//
// Grand total cost: 1_610_000_000 fxp8 == $16.10 (per §10.1.b).
// Sum invariant is checked in the §10.1.d block below; the individual
// rollup tests anchor it from the per-bucket sums in §10.2-§10.4.

type ToggleRow = {
  worktree_path: string
  project_id: number
  project_name: string
  client_name: string
  task: string
}

type MessageRow = {
  message_id: string
  session_id: string
  worktree_path: string
  model_id: string
  ts_created: string
}

type ZenUsageRow = {
  id: string
  session_id: string | null
  model: string
  time_created: string
  cost_fxp8: number
}

const TOGGL_FIXTURE: ToggleRow[] = [
  {
    worktree_path: "~/src/bamboo/ccs/kern/BAM-123",
    project_id: 1,
    project_name: "Kern",
    client_name: "CCS",
    task: "BAM-123",
  },
  {
    worktree_path: "~/src/bamboo/ccs/adventist/BAM-124",
    project_id: 2,
    project_name: "Adventist",
    client_name: "CCS",
    task: "BAM-124",
  },
  {
    worktree_path: "~/src/bamboo/schneller/hardening/SH-987",
    project_id: 3,
    project_name: "Hardening",
    client_name: "Schneller",
    task: "SH-987",
  },
]

const MESSAGES_FIXTURE: MessageRow[] = [
  {
    message_id: "msg_A1",
    session_id: "ses_A1",
    worktree_path: "~/src/bamboo/ccs/kern/BAM-123",
    model_id: "claude-opus-4-7",
    ts_created: "2026-05-19T10:00:00.000Z",
  },
  {
    message_id: "msg_A2",
    session_id: "ses_A2",
    worktree_path: "~/src/bamboo/ccs/kern/BAM-123",
    model_id: "gpt-5-nano",
    ts_created: "2026-05-19T10:05:00.000Z",
  },
  {
    message_id: "msg_B1",
    session_id: "ses_B1",
    worktree_path: "~/src/bamboo/ccs/adventist/BAM-124",
    model_id: "claude-opus-4-7",
    ts_created: "2026-05-19T11:00:00.000Z",
  },
  {
    message_id: "msg_B2",
    session_id: "ses_B2",
    worktree_path: "~/src/bamboo/ccs/adventist/BAM-124",
    model_id: "claude-opus-4-7",
    ts_created: "2026-05-19T11:05:00.000Z",
  },
  {
    message_id: "msg_C1",
    session_id: "ses_C1",
    worktree_path: "~/src/bamboo/schneller/hardening/SH-987",
    model_id: "claude-opus-4-7",
    ts_created: "2026-05-19T12:00:00.000Z",
  },
  {
    message_id: "msg_U1",
    session_id: "ses_U1",
    worktree_path: "~/src/bamboo/some/unmapped/dir",
    model_id: "claude-opus-4-7",
    ts_created: "2026-05-19T13:00:00.000Z",
  },
]

const ZEN_USAGE_FIXTURE: ZenUsageRow[] = [
  // Six rows whose session_id matches a messages row.
  {
    id: "usg_A1",
    session_id: "ses_A1",
    model: "claude-opus-4-7",
    time_created: "2026-05-19T10:00:01.000Z",
    cost_fxp8: 500_000_000, // $5.00
  },
  {
    id: "usg_A2",
    session_id: "ses_A2",
    model: "gpt-5-nano",
    time_created: "2026-05-19T10:05:01.000Z",
    cost_fxp8: 10_000_000, // $0.10
  },
  {
    id: "usg_B1",
    session_id: "ses_B1",
    model: "claude-opus-4-7",
    time_created: "2026-05-19T11:00:01.000Z",
    cost_fxp8: 300_000_000, // $3.00
  },
  {
    id: "usg_B2",
    session_id: "ses_B2",
    model: "claude-opus-4-7",
    time_created: "2026-05-19T11:05:01.000Z",
    cost_fxp8: 200_000_000, // $2.00
  },
  {
    id: "usg_C1",
    session_id: "ses_C1",
    model: "claude-opus-4-7",
    time_created: "2026-05-19T12:00:01.000Z",
    cost_fxp8: 400_000_000, // $4.00
  },
  {
    id: "usg_U1",
    session_id: "ses_U1",
    model: "claude-opus-4-7",
    time_created: "2026-05-19T13:00:01.000Z",
    cost_fxp8: 150_000_000, // $1.50 — unmapped worktree
  },
  // One row whose session_id has no matching messages row.
  {
    id: "usg_X9",
    session_id: "ses_X9",
    model: "claude-opus-4-7",
    time_created: "2026-05-19T14:00:01.000Z",
    cost_fxp8: 50_000_000, // $0.50 — no-local-capture
  },
]

const GRAND_TOTAL_FXP8 = ZEN_USAGE_FIXTURE.reduce((s, r) => s + r.cost_fxp8, 0)
// Sanity self-check at module load: the fixture grand total MUST be $16.10
// per the §10.1.b table. If this ever fails, the fixture has drifted from
// the PLAN contract.
if (GRAND_TOTAL_FXP8 !== 1_610_000_000) {
  throw new Error(
    `by-toggl test fixture grand total drifted: ` +
    `${GRAND_TOTAL_FXP8} != 1_610_000_000`,
  )
}

// --------------------------------------------------------------------------
// DB scaffolding
// --------------------------------------------------------------------------

// We share the per-test tmpdir for the toggl.db sibling file.
let tmpDir: string

// Hosts the opencode-cost.db schema in :memory: and ATTACHes the toggl
// tmpfile as `toggl`. Returns the live handle; teardown closes it.
type FixtureCtx = {
  db: Database
  togglPath: string
}

const TOGGL_SCHEMA = `
  CREATE TABLE toggl_repo_state (
    worktree_path TEXT PRIMARY KEY,
    project_id    INTEGER NOT NULL,
    project_name  TEXT    NOT NULL,
    client_name   TEXT,
    task          TEXT,
    updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
`

const COST_SCHEMA = `
  CREATE TABLE messages (
    message_id            TEXT PRIMARY KEY,
    session_id            TEXT NOT NULL,
    worktree_path         TEXT NOT NULL,
    provider_id           TEXT NOT NULL DEFAULT 'anthropic',
    model_id              TEXT NOT NULL,
    agent                 TEXT,
    ts_created            TEXT NOT NULL,
    ts_completed          TEXT,
    tokens_input          INTEGER NOT NULL DEFAULT 0,
    tokens_output         INTEGER NOT NULL DEFAULT 0,
    tokens_reasoning      INTEGER NOT NULL DEFAULT 0,
    tokens_cache_read     INTEGER NOT NULL DEFAULT 0,
    tokens_cache_write    INTEGER NOT NULL DEFAULT 0,
    tokens_cache_write_5m INTEGER,
    tokens_cache_write_1h INTEGER,
    cost_opencode_fxp8    INTEGER NOT NULL DEFAULT 0,
    cost_recomputed_fxp8  INTEGER NOT NULL DEFAULT 0,
    rate_version          TEXT NOT NULL DEFAULT 'test',
    finish                TEXT,
    raw_json              TEXT
  );

  CREATE TABLE zen_usage (
    id                       TEXT PRIMARY KEY,
    workspace_id             TEXT NOT NULL DEFAULT 'wrk_test',
    session_id               TEXT,
    key_id                   TEXT NOT NULL DEFAULT 'key_test',
    model                    TEXT NOT NULL,
    provider                 TEXT NOT NULL DEFAULT 'anthropic',
    time_created             TEXT NOT NULL,
    time_updated             TEXT NOT NULL,
    time_deleted             TEXT,
    input_tokens             INTEGER NOT NULL DEFAULT 0,
    output_tokens            INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens         INTEGER,
    cache_read_tokens        INTEGER NOT NULL DEFAULT 0,
    cache_write_5m_tokens    INTEGER,
    cache_write_1h_tokens    INTEGER,
    cost_fxp8                INTEGER NOT NULL,
    enrichment_json          TEXT,
    fetched_at               TEXT NOT NULL DEFAULT '2026-05-19T00:00:00.000Z',
    raw_json                 TEXT
  );
`

const writeTogglDb = (path: string, rows: ToggleRow[]): void => {
  const db = new Database(path, { create: true })
  try {
    db.exec(TOGGL_SCHEMA)
    const stmt = db.query(`
      INSERT INTO toggl_repo_state
        (worktree_path, project_id, project_name, client_name, task)
      VALUES (?, ?, ?, ?, ?)
    `)
    for (const r of rows) {
      stmt.run(r.worktree_path, r.project_id, r.project_name, r.client_name, r.task)
    }
  } finally {
    db.close()
  }
}

/**
 * Build the standard §10.1 fixture: tmp toggl.db with three rows, plus
 * an in-memory cost DB with the six messages + seven zen_usage rows,
 * with the toggl.db ATTACHed as `toggl`.
 */
const buildFixture = (
  overrides?: {
    togglRows?: ToggleRow[]
    messages?: MessageRow[]
    zenUsage?: ZenUsageRow[]
  },
): FixtureCtx => {
  const togglPath = join(tmpDir, `toggl-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  writeTogglDb(togglPath, overrides?.togglRows ?? TOGGL_FIXTURE)

  const db = new Database(":memory:")
  db.exec(COST_SCHEMA)

  const messages = overrides?.messages ?? MESSAGES_FIXTURE
  const messageStmt = db.query(`
    INSERT INTO messages
      (message_id, session_id, worktree_path, model_id, ts_created)
    VALUES (?, ?, ?, ?, ?)
  `)
  for (const m of messages) {
    messageStmt.run(m.message_id, m.session_id, m.worktree_path, m.model_id, m.ts_created)
  }

  const zenRows = overrides?.zenUsage ?? ZEN_USAGE_FIXTURE
  const zenStmt = db.query(`
    INSERT INTO zen_usage
      (id, session_id, model, time_created, time_updated, cost_fxp8)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  for (const z of zenRows) {
    zenStmt.run(z.id, z.session_id, z.model, z.time_created, z.time_created, z.cost_fxp8)
  }

  // Path may contain a single quote (it won't in our tmpdir, but be defensive).
  const togglEsc = togglPath.replace(/'/g, "''")
  db.exec(`ATTACH DATABASE '${togglEsc}' AS toggl`)
  return { db, togglPath }
}

const defaultOpts = (overrides: Partial<AggregateOptions>): AggregateOptions => ({
  groupBy: "client" as GroupBy,
  includeUnmapped: true,
  includeUnattributed: true,
  noModelSplit: false,
  ...overrides,
})

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "opencode-cost-by-toggl-test-"))
})

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    // Best-effort; tmp cleanup failure shouldn't fail the test.
  }
})

// --------------------------------------------------------------------------
// §10.2 — Per-client rollup
// --------------------------------------------------------------------------

describe("§10.2 — per-client rollup", () => {
  test("with model split (default): 5 rows, sum $16.10", () => {
    const { db } = buildFixture()
    try {
      const rows = aggregateByToggl(db, defaultOpts({ groupBy: "client" }))

      // §10.2 expected output:
      //   CCS                 | claude-opus-4-7 | $10.00
      //   Schneller           | claude-opus-4-7 | $4.00
      //   (unmapped)          | claude-opus-4-7 | $1.50
      //   (no-local-capture)  | claude-opus-4-7 | $0.50
      //   CCS                 | gpt-5-nano      | $0.10
      expect(rows.length).toBe(5)
      expect(rows[0]).toEqual({
        client: "CCS",
        project: null,
        task: null,
        model: "claude-opus-4-7",
        cost_fxp8: 1_000_000_000, // $10.00
      })
      expect(rows[1]).toEqual({
        client: "Schneller",
        project: null,
        task: null,
        model: "claude-opus-4-7",
        cost_fxp8: 400_000_000, // $4.00
      })
      expect(rows[2]).toEqual({
        client: "(unmapped)",
        project: null,
        task: null,
        model: "claude-opus-4-7",
        cost_fxp8: 150_000_000, // $1.50
      })
      expect(rows[3]).toEqual({
        client: "(no-local-capture)",
        project: null,
        task: null,
        model: "claude-opus-4-7",
        cost_fxp8: 50_000_000, // $0.50
      })
      expect(rows[4]).toEqual({
        client: "CCS",
        project: null,
        task: null,
        model: "gpt-5-nano",
        cost_fxp8: 10_000_000, // $0.10
      })

      // §10.1.d invariant 1 — sum-up consistency at the rollup level.
      const sum = rows.reduce((s, r) => s + r.cost_fxp8, 0)
      expect(sum).toBe(1_610_000_000)
    } finally {
      db.close()
    }
  })

  test("with --no-model-split: 4 rows, CCS collapses to $10.10", () => {
    const { db } = buildFixture()
    try {
      const rows = aggregateByToggl(
        db,
        defaultOpts({ groupBy: "client", noModelSplit: true }),
      )

      // §10.2 with --no-model-split:
      //   CCS                 | $10.10
      //   Schneller           | $4.00
      //   (unmapped)          | $1.50
      //   (no-local-capture)  | $0.50
      expect(rows.length).toBe(4)
      expect(rows[0]).toEqual({
        client: "CCS",
        project: null,
        task: null,
        model: null,
        cost_fxp8: 1_010_000_000, // $10.10 = $10.00 + $0.10
      })
      expect(rows[1].client).toBe("Schneller")
      expect(rows[1].cost_fxp8).toBe(400_000_000)
      expect(rows[2].client).toBe("(unmapped)")
      expect(rows[2].cost_fxp8).toBe(150_000_000)
      expect(rows[3].client).toBe("(no-local-capture)")
      expect(rows[3].cost_fxp8).toBe(50_000_000)

      const sum = rows.reduce((s, r) => s + r.cost_fxp8, 0)
      expect(sum).toBe(1_610_000_000)
    } finally {
      db.close()
    }
  })
})

// --------------------------------------------------------------------------
// §10.3 — Per-project rollup
// --------------------------------------------------------------------------

describe("§10.3 — per-project rollup", () => {
  test("with model split (default): 6 rows, ties broken by (client, project) asc", () => {
    const { db } = buildFixture()
    try {
      const rows = aggregateByToggl(db, defaultOpts({ groupBy: "project" }))

      // §10.3 expected output:
      //   CCS                 | Adventist           | claude-opus-4-7 | $5.00
      //   CCS                 | Kern                | claude-opus-4-7 | $5.00
      //   Schneller           | Hardening           | claude-opus-4-7 | $4.00
      //   (unmapped)          | (unmapped)          | claude-opus-4-7 | $1.50
      //   (no-local-capture)  | (no-local-capture)  | claude-opus-4-7 | $0.50
      //   CCS                 | Kern                | gpt-5-nano      | $0.10
      expect(rows.length).toBe(6)

      // Adventist and Kern are tied at $5.00; (client, project) asc
      // puts Adventist first.
      expect(rows[0]).toEqual({
        client: "CCS",
        project: "Adventist",
        task: null,
        model: "claude-opus-4-7",
        cost_fxp8: 500_000_000, // $5.00 = ses_B1 ($3.00) + ses_B2 ($2.00)
      })
      expect(rows[1]).toEqual({
        client: "CCS",
        project: "Kern",
        task: null,
        model: "claude-opus-4-7",
        cost_fxp8: 500_000_000, // $5.00 = ses_A1
      })
      expect(rows[2]).toEqual({
        client: "Schneller",
        project: "Hardening",
        task: null,
        model: "claude-opus-4-7",
        cost_fxp8: 400_000_000, // $4.00
      })
      expect(rows[3]).toEqual({
        client: "(unmapped)",
        project: "(unmapped)",
        task: null,
        model: "claude-opus-4-7",
        cost_fxp8: 150_000_000,
      })
      expect(rows[4]).toEqual({
        client: "(no-local-capture)",
        project: "(no-local-capture)",
        task: null,
        model: "claude-opus-4-7",
        cost_fxp8: 50_000_000,
      })
      expect(rows[5]).toEqual({
        client: "CCS",
        project: "Kern",
        task: null,
        model: "gpt-5-nano",
        cost_fxp8: 10_000_000, // $0.10
      })

      const sum = rows.reduce((s, r) => s + r.cost_fxp8, 0)
      expect(sum).toBe(1_610_000_000)
    } finally {
      db.close()
    }
  })
})

// --------------------------------------------------------------------------
// §10.4 — Per-task rollup
// --------------------------------------------------------------------------

describe("§10.4 — per-task rollup", () => {
  test("with model split (default): 6 rows, byte-exact attribution", () => {
    const { db } = buildFixture()
    try {
      const rows = aggregateByToggl(db, defaultOpts({ groupBy: "task" }))

      // §10.4 expected output:
      //   CCS                 | Adventist           | BAM-124             | claude-opus-4-7 | $5.00
      //   CCS                 | Kern                | BAM-123             | claude-opus-4-7 | $5.00
      //   Schneller           | Hardening           | SH-987              | claude-opus-4-7 | $4.00
      //   (unmapped)          | (unmapped)          | (unmapped)          | claude-opus-4-7 | $1.50
      //   (no-local-capture)  | (no-local-capture)  | (no-local-capture)  | claude-opus-4-7 | $0.50
      //   CCS                 | Kern                | BAM-123             | gpt-5-nano      | $0.10
      expect(rows.length).toBe(6)

      expect(rows[0]).toEqual({
        client: "CCS",
        project: "Adventist",
        task: "BAM-124",
        model: "claude-opus-4-7",
        cost_fxp8: 500_000_000,
      })
      expect(rows[1]).toEqual({
        client: "CCS",
        project: "Kern",
        task: "BAM-123",
        model: "claude-opus-4-7",
        cost_fxp8: 500_000_000,
      })
      expect(rows[2]).toEqual({
        client: "Schneller",
        project: "Hardening",
        task: "SH-987",
        model: "claude-opus-4-7",
        cost_fxp8: 400_000_000,
      })
      expect(rows[3]).toEqual({
        client: "(unmapped)",
        project: "(unmapped)",
        task: "(unmapped)",
        model: "claude-opus-4-7",
        cost_fxp8: 150_000_000,
      })
      expect(rows[4]).toEqual({
        client: "(no-local-capture)",
        project: "(no-local-capture)",
        task: "(no-local-capture)",
        model: "claude-opus-4-7",
        cost_fxp8: 50_000_000,
      })
      expect(rows[5]).toEqual({
        client: "CCS",
        project: "Kern",
        task: "BAM-123",
        model: "gpt-5-nano",
        cost_fxp8: 10_000_000,
      })

      const sum = rows.reduce((s, r) => s + r.cost_fxp8, 0)
      expect(sum).toBe(1_610_000_000)
    } finally {
      db.close()
    }
  })
})

// --------------------------------------------------------------------------
// §10.1.d — Shared invariants (apply to all three rollups)
// --------------------------------------------------------------------------

describe("§10.1.d invariants", () => {
  test("1. sum-up consistency: task → project → client → grand total", () => {
    const { db } = buildFixture()
    try {
      const byTask = aggregateByToggl(db, defaultOpts({ groupBy: "task" }))
      const byProject = aggregateByToggl(db, defaultOpts({ groupBy: "project" }))
      const byClient = aggregateByToggl(db, defaultOpts({ groupBy: "client" }))

      // Sum at each granularity matches the grand total.
      const sumTask = byTask.reduce((s, r) => s + r.cost_fxp8, 0)
      const sumProject = byProject.reduce((s, r) => s + r.cost_fxp8, 0)
      const sumClient = byClient.reduce((s, r) => s + r.cost_fxp8, 0)

      expect(sumTask).toBe(1_610_000_000)
      expect(sumProject).toBe(1_610_000_000)
      expect(sumClient).toBe(1_610_000_000)

      // Sum of per-task costs for each (client, project, model) equals
      // the per-project cell for the same (client, project, model).
      const taskByProjectKey = new Map<string, number>()
      for (const r of byTask) {
        const key = `${r.client}\0${r.project}\0${r.model}`
        taskByProjectKey.set(key, (taskByProjectKey.get(key) ?? 0) + r.cost_fxp8)
      }
      for (const r of byProject) {
        const key = `${r.client}\0${r.project}\0${r.model}`
        expect(taskByProjectKey.get(key)).toBe(r.cost_fxp8)
      }

      // Same for project → client.
      const projectByClientKey = new Map<string, number>()
      for (const r of byProject) {
        const key = `${r.client}\0${r.model}`
        projectByClientKey.set(key, (projectByClientKey.get(key) ?? 0) + r.cost_fxp8)
      }
      for (const r of byClient) {
        const key = `${r.client}\0${r.model}`
        expect(projectByClientKey.get(key)).toBe(r.cost_fxp8)
      }
    } finally {
      db.close()
    }
  })

  test("2. deterministic attribution: every zen_usage row contributes exactly once", () => {
    const { db } = buildFixture()
    try {
      // Each zen_usage row's cost should appear once and only once in
      // the per-task rollup, attributed to a single bucket.
      const rows = aggregateByToggl(db, defaultOpts({ groupBy: "task" }))

      // Total cost == sum of zen_usage costs (no row dropped, no row counted twice).
      const sum = rows.reduce((s, r) => s + r.cost_fxp8, 0)
      const zenSum = ZEN_USAGE_FIXTURE.reduce((s, r) => s + r.cost_fxp8, 0)
      expect(sum).toBe(zenSum)

      // Every (mapped) zen_usage row's cost is reachable in exactly one
      // (client, project, task, model) bucket.
      for (const z of ZEN_USAGE_FIXTURE) {
        // Find which bucket this row should land in.
        const message = MESSAGES_FIXTURE.find((m) => m.session_id === z.session_id)
        if (!message) {
          // ses_X9 → (no-local-capture) bucket.
          const bucket = rows.find(
            (r) => r.client === "(no-local-capture)" && r.model === z.model,
          )
          expect(bucket).toBeDefined()
          continue
        }
        const togglRow = TOGGL_FIXTURE.find(
          (t) => t.worktree_path === message.worktree_path,
        )
        if (!togglRow) {
          // ses_U1 → (unmapped) bucket.
          const bucket = rows.find(
            (r) => r.client === "(unmapped)" && r.model === z.model,
          )
          expect(bucket).toBeDefined()
          continue
        }
        const bucket = rows.find(
          (r) =>
            r.client === togglRow.client_name &&
            r.project === togglRow.project_name &&
            r.task === togglRow.task &&
            r.model === z.model,
        )
        expect(bucket).toBeDefined()
      }
    } finally {
      db.close()
    }
  })

  test("3. stable across re-runs: byte-identical output for the same DB", () => {
    const { db } = buildFixture()
    try {
      const opts = defaultOpts({ groupBy: "task" })
      const a = aggregateByToggl(db, opts)
      const b = aggregateByToggl(db, opts)
      const c = aggregateByToggl(db, opts)

      // JSON.stringify forces byte-exact comparison of the structured
      // output (order + values + types).
      const aJson = JSON.stringify(a)
      const bJson = JSON.stringify(b)
      const cJson = JSON.stringify(c)

      expect(bJson).toBe(aJson)
      expect(cJson).toBe(aJson)
    } finally {
      db.close()
    }
  })

  test("4. integer-fxp8 only: cost_fxp8 stays integer through aggregation", () => {
    const { db } = buildFixture()
    try {
      const rows = aggregateByToggl(db, defaultOpts({ groupBy: "task" }))
      for (const r of rows) {
        expect(Number.isInteger(r.cost_fxp8)).toBe(true)
      }
      // Spot-check: $10.10 in fxp8 should not have been touched by a
      // float multiply/divide. 1_010_000_000 only appears if the SUM
      // was integer-arithmetic the whole way.
      const byClient = aggregateByToggl(
        db,
        defaultOpts({ groupBy: "client", noModelSplit: true }),
      )
      const ccs = byClient.find((r) => r.client === "CCS")
      expect(ccs?.cost_fxp8).toBe(1_010_000_000)
    } finally {
      db.close()
    }
  })
})

// --------------------------------------------------------------------------
// §10.1.e — Shared edge cases
// --------------------------------------------------------------------------

describe("§10.1.e edge cases", () => {
  test("a. unmapped worktree surfaces as (unmapped) bucket", () => {
    const { db } = buildFixture()
    try {
      const rows = aggregateByToggl(db, defaultOpts({ groupBy: "task" }))
      const unmapped = rows.find((r) => r.client === "(unmapped)")
      expect(unmapped).toBeDefined()
      expect(unmapped?.cost_fxp8).toBe(150_000_000) // ses_U1 → $1.50

      // Cost counted, not silently dropped.
      const sum = rows.reduce((s, r) => s + r.cost_fxp8, 0)
      expect(sum).toBe(1_610_000_000)

      // --no-include-unmapped drops the bucket but the rest unchanged.
      const filtered = aggregateByToggl(
        db,
        defaultOpts({ groupBy: "task", includeUnmapped: false }),
      )
      expect(filtered.find((r) => r.client === "(unmapped)")).toBeUndefined()
      const filteredSum = filtered.reduce((s, r) => s + r.cost_fxp8, 0)
      expect(filteredSum).toBe(1_610_000_000 - 150_000_000)
    } finally {
      db.close()
    }
  })

  test("b. unattributed zen row surfaces as (no-local-capture) bucket", () => {
    const { db } = buildFixture()
    try {
      const rows = aggregateByToggl(db, defaultOpts({ groupBy: "task" }))
      const noLocal = rows.find((r) => r.client === "(no-local-capture)")
      expect(noLocal).toBeDefined()
      expect(noLocal?.cost_fxp8).toBe(50_000_000) // ses_X9 → $0.50

      // --no-include-unattributed drops it.
      const filtered = aggregateByToggl(
        db,
        defaultOpts({ groupBy: "task", includeUnattributed: false }),
      )
      expect(filtered.find((r) => r.client === "(no-local-capture)")).toBeUndefined()
      const filteredSum = filtered.reduce((s, r) => s + r.cost_fxp8, 0)
      expect(filteredSum).toBe(1_610_000_000 - 50_000_000)
    } finally {
      db.close()
    }
  })

  test("c. retargeted via toggl-set mid-history: current state authoritative", () => {
    // Simulate the user running `toggl-set` to change the mapping
    // for ses_A1's worktree from (CCS/Kern/BAM-123) to (CCS/Kern/BAM-999).
    // Per §10.1.e: "Current toggl_repo_state is authoritative at query
    // time. Historical rollups retroactively reflect new mapping."
    const retargetedToggl: ToggleRow[] = TOGGL_FIXTURE.map((t) =>
      t.worktree_path === "~/src/bamboo/ccs/kern/BAM-123"
        ? { ...t, task: "BAM-999" }
        : t,
    )

    const { db } = buildFixture({ togglRows: retargetedToggl })
    try {
      const rows = aggregateByToggl(db, defaultOpts({ groupBy: "task" }))
      // ses_A1's $5.00 should now show up under BAM-999, not BAM-123.
      const bam999 = rows.find((r) => r.task === "BAM-999" && r.model === "claude-opus-4-7")
      expect(bam999).toBeDefined()
      expect(bam999?.cost_fxp8).toBe(500_000_000)

      // Old BAM-123 only retains the gpt-5-nano $0.10 row from ses_A2
      // (also using the same worktree → also retargeted).
      const bam123Claude = rows.find(
        (r) => r.task === "BAM-123" && r.model === "claude-opus-4-7",
      )
      expect(bam123Claude).toBeUndefined()

      // BAM-999 should aggregate both claude (ses_A1, $5.00) and
      // the gpt-5-nano row (ses_A2, $0.10) — same worktree, both
      // retargeted.
      const bam999Nano = rows.find(
        (r) => r.task === "BAM-999" && r.model === "gpt-5-nano",
      )
      expect(bam999Nano?.cost_fxp8).toBe(10_000_000)

      // Grand total preserved.
      const sum = rows.reduce((s, r) => s + r.cost_fxp8, 0)
      expect(sum).toBe(1_610_000_000)
    } finally {
      db.close()
    }
  })

  test("d. title-gen / subagent inherits parent's mapping via worktree JOIN", () => {
    // Title-gen and subagent sessions are different session_ids but
    // share the parent's worktree_path. The §10.1.c JOIN goes through
    // worktree, so they naturally land in the parent's bucket.
    //
    // Set up: a "subagent" session ses_A1_sub in the same worktree as
    // ses_A1 (BAM-123/Kern/CCS), with its own zen_usage row.
    const subMessages: MessageRow[] = [
      ...MESSAGES_FIXTURE,
      {
        message_id: "msg_A1_sub",
        session_id: "ses_A1_sub",
        worktree_path: "~/src/bamboo/ccs/kern/BAM-123",
        model_id: "claude-opus-4-7",
        ts_created: "2026-05-19T10:30:00.000Z",
      },
    ]
    const subZen: ZenUsageRow[] = [
      ...ZEN_USAGE_FIXTURE,
      {
        id: "usg_A1_sub",
        session_id: "ses_A1_sub",
        model: "claude-opus-4-7",
        time_created: "2026-05-19T10:30:01.000Z",
        cost_fxp8: 75_000_000, // $0.75 — subagent cost
      },
    ]

    const { db } = buildFixture({ messages: subMessages, zenUsage: subZen })
    try {
      const rows = aggregateByToggl(db, defaultOpts({ groupBy: "task" }))
      // BAM-123 claude row should now be ses_A1 ($5.00) + ses_A1_sub ($0.75) = $5.75.
      const bam123Claude = rows.find(
        (r) => r.task === "BAM-123" && r.model === "claude-opus-4-7",
      )
      expect(bam123Claude?.cost_fxp8).toBe(575_000_000)

      // No new (unmapped) or (no-local-capture) rows from the subagent
      // — its worktree IS mapped, and it DOES have a messages row.
      const grandSum = rows.reduce((s, r) => s + r.cost_fxp8, 0)
      expect(grandSum).toBe(1_610_000_000 + 75_000_000)
    } finally {
      db.close()
    }
  })

  test("e. toggl.db missing — runByToggl exits non-zero with diagnostic", () => {
    // The CLI entry path. We bypass the test fixture entirely and run
    // runByToggl with a --toggl-db pointing at a path that doesn't
    // exist. Per the locked decision #8: must exit non-zero with a
    // pointer at toggl-set.
    const fakePath = join(tmpDir, "definitely-does-not-exist.db")
    expect(existsSync(fakePath)).toBe(false)

    // Capture stderr to verify the diagnostic.
    const stderrChunks: string[] = []
    const origStderrWrite = process.stderr.write.bind(process.stderr)
    const origConsoleError = console.error
    console.error = (...args: unknown[]) => {
      stderrChunks.push(args.map((a) => String(a)).join(" "))
    }
    process.stderr.write = ((chunk: unknown) => {
      stderrChunks.push(String(chunk))
      return true
    }) as typeof process.stderr.write

    // Also need a cost DB. Create an empty one in tmpDir; the runByToggl
    // path should short-circuit on toggl missing before it ever opens
    // the cost DB.
    const costPath = join(tmpDir, "cost.db")
    const cost = new Database(costPath, { create: true })
    cost.exec(COST_SCHEMA)
    cost.close()

    let exitCode: number
    const origCostDb = process.env.OPENCODE_COST_DB
    process.env.OPENCODE_COST_DB = costPath
    try {
      exitCode = runByToggl([
        "--group-by", "task",
        "--toggl-db", fakePath,
      ])
    } finally {
      if (origCostDb === undefined) delete process.env.OPENCODE_COST_DB
      else process.env.OPENCODE_COST_DB = origCostDb
      process.stderr.write = origStderrWrite
      console.error = origConsoleError
    }

    expect(exitCode).not.toBe(0)
    const stderr = stderrChunks.join("")
    expect(stderr).toContain("toggl.db not found")
    expect(stderr).toContain("toggl-set")
  })
})

// --------------------------------------------------------------------------
// CLI surface — JSON output exits 0, fxp8 INTEGER preserved
// --------------------------------------------------------------------------

describe("CLI surface", () => {
  test("--json keeps fxp8 INTEGER columns; --group-by required", () => {
    // First: --group-by required.
    const stderrChunks: string[] = []
    const origConsoleError = console.error
    console.error = (...args: unknown[]) => {
      stderrChunks.push(args.map((a) => String(a)).join(" "))
    }
    const stderrWriteOrig = process.stderr.write.bind(process.stderr)
    process.stderr.write = (() => true) as typeof process.stderr.write
    try {
      const code = runByToggl([])
      expect(code).toBe(2)
      expect(stderrChunks.join("")).toContain("--group-by is required")
    } finally {
      console.error = origConsoleError
      process.stderr.write = stderrWriteOrig
    }
  })

  test("--json output round-trips back to the AggregatedRow set", () => {
    // We can't easily intercept process.stdout from a single bun:test
    // run, but we can call the underlying aggregator directly and the
    // CLI wrapper through stdout-capture. Use a temp file by piping
    // stdout to it during the call.
    const { db, togglPath } = buildFixture()
    db.close()

    // Build a real cost DB on disk so runByToggl can open it readonly.
    const costPath = join(tmpDir, "cost.db")
    const cost = new Database(costPath, { create: true })
    cost.exec(COST_SCHEMA)
    const messageStmt = cost.query(`
      INSERT INTO messages
        (message_id, session_id, worktree_path, model_id, ts_created)
      VALUES (?, ?, ?, ?, ?)
    `)
    for (const m of MESSAGES_FIXTURE) {
      messageStmt.run(m.message_id, m.session_id, m.worktree_path, m.model_id, m.ts_created)
    }
    const zenStmt = cost.query(`
      INSERT INTO zen_usage
        (id, session_id, model, time_created, time_updated, cost_fxp8)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (const z of ZEN_USAGE_FIXTURE) {
      zenStmt.run(z.id, z.session_id, z.model, z.time_created, z.time_created, z.cost_fxp8)
    }
    cost.close()

    // Capture stdout.
    const stdoutChunks: string[] = []
    const origStdoutWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: unknown) => {
      stdoutChunks.push(String(chunk))
      return true
    }) as typeof process.stdout.write

    let exitCode: number
    const origCostDb = process.env.OPENCODE_COST_DB
    process.env.OPENCODE_COST_DB = costPath
    try {
      exitCode = runByToggl([
        "--group-by", "client",
        "--toggl-db", togglPath,
        "--json",
      ])
    } finally {
      if (origCostDb === undefined) delete process.env.OPENCODE_COST_DB
      else process.env.OPENCODE_COST_DB = origCostDb
      process.stdout.write = origStdoutWrite
    }

    expect(exitCode).toBe(0)

    const out = stdoutChunks.join("")
    const parsed = JSON.parse(out) as Array<{
      client: string
      model: string
      cost_fxp8: number
    }>
    expect(parsed.length).toBe(5)
    // cost_fxp8 stays INTEGER (no division).
    for (const r of parsed) {
      expect(Number.isInteger(r.cost_fxp8)).toBe(true)
    }
    // Spot-check: $10.00 is the largest single (CCS, claude-opus-4-7).
    expect(parsed[0].client).toBe("CCS")
    expect(parsed[0].cost_fxp8).toBe(1_000_000_000)

    // Grand total invariant.
    const sum = parsed.reduce((s, r) => s + r.cost_fxp8, 0)
    expect(sum).toBe(1_610_000_000)
  })
})
