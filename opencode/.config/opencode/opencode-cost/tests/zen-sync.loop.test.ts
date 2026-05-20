// opencode-cost/tests/zen-sync.loop.test.ts — Z3' RED scaffolds for the
// per-row Zen `_server` sync loop.
//
// Acceptance contract: ../../../../docs/plans/opencode-cost-pertask-tmux-status/PLAN.md
// §10.6.a through §10.6.l.
//
// Status when this file lands (Commit 3): RED. The new entry points
// `syncAll` (the pagination loop) and `acquireSyncLock` (the flock(2)
// advisory) do not yet exist in zen-sync.ts. Z3 introduces them in
// Commit 4. Importing them today resolves to `undefined`; the suite
// is fully RED — exactly the signal Commit 4 needs to GREEN.
//
// Implementation sketch the tests pin (PLAN §5.2):
//
//   syncAll({
//     cookie, config, db,
//     mode: "incremental" | "full",
//     maxPages?: number,
//   }) → Promise<{
//     written: number,           // upserts that actually changed the table
//     fetched: number,           // total rows downloaded across all pages
//     pagesFetched: number,      // page-0 .. page-N inclusive
//   }>
//
//   acquireSyncLock(lockDir: string) → Promise<{
//     release: () => Promise<void>,
//     pid: number,
//     since: string,             // ISO 8601
//   } | null>                    // null when contended
//
// Mock `_server`: a small in-process fake that holds an Array<MockRow>
// and slices it on (workspaceId, page) requests. Tests script the
// mock per case.
//
// Run from the repo root:
//   bun test ./opencode/.config/opencode/opencode-cost/tests/zen-sync.loop.test.ts

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// IMPORTANT: `syncAll` and `acquireSyncLock` are Z3's new exports. They
// do NOT exist in zen-sync.ts yet. We use a namespace import so module
// loading succeeds; the missing functions resolve to `undefined` and
// each individual test fails when it calls them. That granular per-test
// RED signal is what Commit 4's GREEN delivery flips to passing.
import * as zenSync from "../zen-sync.ts"

// ZenSyncConfig already exists in zen-sync.ts; pull it through the
// namespace for type clarity.
type ZenSyncConfig = {
  workspaceId: string
  keyId: string
  tzOffset: string
  serverId: string
  fnIndex?: number
}

type SyncAllResult = {
  written: number
  fetched: number
  pagesFetched: number
}

type SyncLockHandle = {
  release: () => Promise<void>
  pid: number
  since: string
}

const syncAll = async (opts: {
  cookie: string
  config: ZenSyncConfig
  db: Database
  mode: "incremental" | "full"
  maxPages?: number
}): Promise<SyncAllResult> => {
  const fn = (zenSync as any).syncAll
  if (typeof fn !== "function") {
    throw new Error(
      "zen-sync.ts does not yet export syncAll — Z3 is unstarted " +
      "(PLAN.md §9 Commit 4 / P4.3).",
    )
  }
  return fn(opts) as Promise<SyncAllResult>
}

const acquireSyncLock = async (lockDir: string): Promise<SyncLockHandle | null> => {
  const fn = (zenSync as any).acquireSyncLock
  if (typeof fn !== "function") {
    throw new Error(
      "zen-sync.ts does not yet export acquireSyncLock — Z3 flock(2) " +
      "is unstarted (PLAN.md §5.3 + §9 Commit 4 / P4.3).",
    )
  }
  return fn(lockDir) as Promise<SyncLockHandle | null>
}

const runZenSync = (argv: string[]): Promise<number> =>
  (zenSync as any).runZenSync(argv) as Promise<number>

// --------------------------------------------------------------------------
// Test fixtures + helpers
// --------------------------------------------------------------------------

const PAGE_SIZE = 50  // PLAN §5.2: empirically observed Zen page size.

type MockRow = {
  id: string
  timeCreated: string  // ISO 8601
  sessionId?: string
  cost?: number        // fxp8
}

const renderRow = (r: MockRow): string => {
  const sessionId = r.sessionId ?? `ses_${r.id}`
  const cost = r.cost ?? 100
  return [
    `{id:${JSON.stringify(r.id)}`,
    `workspaceId:"wrk_test"`,
    `sessionId:${JSON.stringify(sessionId)}`,
    `keyId:"key_test"`,
    `model:"claude-opus-4-7"`,
    `provider:"anthropic"`,
    `timeCreated:new Date(${JSON.stringify(r.timeCreated)})`,
    `timeUpdated:new Date(${JSON.stringify(r.timeCreated)})`,
    `timeDeleted:null`,
    `inputTokens:1`,
    `outputTokens:1`,
    `reasoningTokens:null`,
    `cacheReadTokens:0`,
    `cacheWrite5mTokens:null`,
    `cacheWrite1hTokens:null`,
    `cost:${cost}}`,
  ].join(",")
}

const buildResponseBody = (rows: MockRow[]): string =>
  `$R[0]=[${rows.map(renderRow).join(",")}]`

// In-process mock for the Zen `_server` endpoint. Replaces globalThis.fetch
// with a spy that slices the held rows array by (workspaceId, page) and
// returns the response body in the same JS-literal-subset format the real
// Zen endpoint emits.
type MockServer = {
  state: {
    rows: MockRow[]
    fetchCount: number
    pageCalls: number[]
  }
  /** Insert rows at the front (simulates mid-sync arrivals from §10.6.l). */
  insertAtFront: (...newRows: MockRow[]) => void
  /** Restore the original fetch — call from afterEach. */
  restore: () => void
}

type MockServerOpts = {
  /** Initial rows held by the mock. */
  rows: MockRow[]
  /** Fixed page size. Defaults to PAGE_SIZE (50). Set higher to simulate drift up. */
  pageSize?: number
  /** Hook fired after each page fetch but before the response resolves. */
  afterPage?: (page: number, state: MockServer["state"]) => void
  /** If set, always return this many rows regardless of slice — for §10.6.h. */
  infinite?: boolean
}

const installMockServer = (opts: MockServerOpts): MockServer => {
  const state: MockServer["state"] = {
    rows: [...opts.rows],
    fetchCount: 0,
    pageCalls: [],
  }
  const pageSize = opts.pageSize ?? PAGE_SIZE
  const originalFetch = globalThis.fetch

  globalThis.fetch = mock(async (url: unknown, init?: any) => {
    state.fetchCount++
    let page = 0
    try {
      const body = JSON.parse(String(init?.body ?? "{}"))
      // PLAN §5.1: body shape is { t: { a: [ {s: workspaceId}, {s: page} ] } }
      page = Number(body?.t?.a?.[1]?.s ?? 0)
    } catch {
      // Tolerate test setups that probe the mock without a real body.
    }
    state.pageCalls.push(page)

    let slice: MockRow[]
    if (opts.infinite) {
      // Generate a fresh full page every time without bounding total.
      slice = Array.from({ length: pageSize }, (_, i) => ({
        id: `usg_inf_p${page}_i${i}`,
        timeCreated: `2026-05-19T00:${String(page % 60).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z`,
        cost: 1,
      }))
    } else {
      slice = state.rows.slice(page * pageSize, (page + 1) * pageSize)
    }

    if (opts.afterPage) opts.afterPage(page, state)

    return new Response(buildResponseBody(slice), { status: 200 })
  }) as unknown as typeof fetch

  return {
    state,
    insertAtFront: (...newRows: MockRow[]) => {
      state.rows = [...newRows, ...state.rows]
    },
    restore: () => {
      globalThis.fetch = originalFetch
    },
  }
}

// In-memory zen_usage table per PLAN §4.1 schema.
const setupDb = (): Database => {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE zen_usage (
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
    CREATE INDEX idx_zen_usage_session ON zen_usage(session_id);
    CREATE INDEX idx_zen_usage_day     ON zen_usage(substr(time_created, 1, 10), model);
    CREATE INDEX idx_zen_usage_time    ON zen_usage(time_created);
  `)
  return db
}

const TEST_CONFIG: ZenSyncConfig = {
  workspaceId: "wrk_test",
  keyId: "key_test",
  tzOffset: "-04:00",
  serverId: "test-server-id",
  fnIndex: 31,
}

const makeRows = (count: number, prefix = "usg", isoBase = "2026-05-19T00:00:00.000Z"): MockRow[] => {
  // Generate timestamps strictly descending (Zen returns newest first per page).
  const baseMs = Date.parse(isoBase)
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}_${i.toString().padStart(5, "0")}`,
    timeCreated: new Date(baseMs - i * 1000).toISOString(),
    cost: 100 + i,
  }))
}

// --------------------------------------------------------------------------
// Suite setup / teardown
// --------------------------------------------------------------------------

let server: MockServer | null = null
let db: Database | null = null

afterEach(() => {
  if (server) {
    server.restore()
    server = null
  }
  if (db) {
    db.close()
    db = null
  }
})

// --------------------------------------------------------------------------
// §10.6.a — Empty page
// --------------------------------------------------------------------------
//
// Page 0 returns []. Loop must exit cleanly without further pagination.
// No DB writes; 0 rows returned.
describe("§10.6.a — empty page", () => {
  test("loop exits cleanly with zero writes", async () => {
    server = installMockServer({ rows: [] })
    db = setupDb()
    const result = await syncAll({
      cookie: "test-cookie",
      config: TEST_CONFIG,
      db,
      mode: "incremental",
    })
    expect(result.written).toBe(0)
    expect(result.pagesFetched).toBe(1)
    expect(server.state.pageCalls).toEqual([0])
    const count = (db.query("SELECT COUNT(*) AS n FROM zen_usage").get() as any).n
    expect(count).toBe(0)
  })
})

// --------------------------------------------------------------------------
// §10.6.b — Short page (single page, less than PAGE_SIZE)
// --------------------------------------------------------------------------
//
// Page 0 returns 30 rows (< PAGE_SIZE). Loop stores all 30 and stops
// without fetching page 1.
describe("§10.6.b — short first page", () => {
  test("stores 30 rows and does not fetch page 1", async () => {
    const rows = makeRows(30)
    server = installMockServer({ rows })
    db = setupDb()
    const result = await syncAll({
      cookie: "test-cookie",
      config: TEST_CONFIG,
      db,
      mode: "incremental",
    })
    expect(result.written).toBe(30)
    expect(result.pagesFetched).toBe(1)
    expect(server.state.pageCalls).toEqual([0])
    const count = (db.query("SELECT COUNT(*) AS n FROM zen_usage").get() as any).n
    expect(count).toBe(30)
  })
})

// --------------------------------------------------------------------------
// §10.6.c — Full then empty
// --------------------------------------------------------------------------
//
// Page 0 returns PAGE_SIZE rows; page 1 returns []. Loop stores 50 and
// exits at page 1.
describe("§10.6.c — full then empty", () => {
  test("stores 50 rows, fetches pages [0, 1]", async () => {
    const rows = makeRows(50)
    server = installMockServer({ rows })
    db = setupDb()
    const result = await syncAll({
      cookie: "test-cookie",
      config: TEST_CONFIG,
      db,
      mode: "incremental",
    })
    expect(result.written).toBe(50)
    expect(result.pagesFetched).toBe(2)
    expect(server.state.pageCalls).toEqual([0, 1])
    const count = (db.query("SELECT COUNT(*) AS n FROM zen_usage").get() as any).n
    expect(count).toBe(50)
  })
})

// --------------------------------------------------------------------------
// §10.6.d — Full then short
// --------------------------------------------------------------------------
//
// Page 0 returns 50; page 1 returns 17 (< PAGE_SIZE). Loop stores 67 and
// exits after page 1 (short-page guard).
describe("§10.6.d — full then short", () => {
  test("stores 67 rows, fetches pages [0, 1]", async () => {
    const rows = makeRows(67)
    server = installMockServer({ rows })
    db = setupDb()
    const result = await syncAll({
      cookie: "test-cookie",
      config: TEST_CONFIG,
      db,
      mode: "incremental",
    })
    expect(result.written).toBe(67)
    expect(result.pagesFetched).toBe(2)
    expect(server.state.pageCalls).toEqual([0, 1])
    const count = (db.query("SELECT COUNT(*) AS n FROM zen_usage").get() as any).n
    expect(count).toBe(67)
  })
})

// --------------------------------------------------------------------------
// §10.6.e — Incremental stop on newestKnown overlap
// --------------------------------------------------------------------------
//
// DB already has rows up to time_created = T. Page 0 returns 50 rows
// half newer / half older than T. Page 1 returns 50 rows all older
// than T (so every row ≤ T → loop stops per PLAN §5.2).
//
// Expected: pagesFetched=2; loop stops after page 1. The newer half of
// page 0 are net-new inserts; the rest are no-op REPLACEs on existing
// rows.
describe("§10.6.e — incremental stop on newestKnown", () => {
  test("loop stops after page 1 when all rows ≤ newestKnown", async () => {
    const T = "2026-05-19T00:00:00.000Z"
    const TMs = Date.parse(T)

    // 25 rows after T (newer), 25 rows before T (older equal-or-less).
    const page0Rows: MockRow[] = []
    for (let i = 0; i < 25; i++) {
      page0Rows.push({
        id: `usg_e_new_${i}`,
        timeCreated: new Date(TMs + (i + 1) * 1000).toISOString(),
        cost: 1,
      })
    }
    for (let i = 0; i < 25; i++) {
      page0Rows.push({
        id: `usg_e_old_${i}`,
        timeCreated: new Date(TMs - (i + 1) * 1000).toISOString(),
        cost: 1,
      })
    }
    // Page 1 — all strictly older than T.
    const page1Rows: MockRow[] = []
    for (let i = 0; i < 50; i++) {
      page1Rows.push({
        id: `usg_e_p1_${i}`,
        timeCreated: new Date(TMs - (i + 100) * 1000).toISOString(),
        cost: 1,
      })
    }

    server = installMockServer({ rows: [...page0Rows, ...page1Rows] })
    db = setupDb()

    // Seed DB with the older equal-or-less rows so newestKnown is T.
    const seed = db.query(`
      INSERT INTO zen_usage (
        id, workspace_id, session_id, key_id, model, provider,
        time_created, time_updated, time_deleted,
        input_tokens, output_tokens, reasoning_tokens,
        cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens,
        cost_fxp8, enrichment_json, fetched_at, raw_json
      ) VALUES (?, 'wrk_test', NULL, 'key_test', 'claude-opus-4-7',
                'anthropic', ?, ?, NULL, 0, 0, NULL, 0, NULL, NULL, 0,
                NULL, ?, NULL)`)
    seed.run("usg_seed_at_T", T, T, T)

    const result = await syncAll({
      cookie: "test-cookie",
      config: TEST_CONFIG,
      db,
      mode: "incremental",
    })
    expect(result.pagesFetched).toBe(2)
    expect(server.state.pageCalls).toEqual([0, 1])
    // 25 net-new rows from page 0 (the newer half).
    const newCount = (db.query(
      "SELECT COUNT(*) AS n FROM zen_usage WHERE id LIKE 'usg_e_new_%'",
    ).get() as any).n
    expect(newCount).toBe(25)
  })
})

// --------------------------------------------------------------------------
// §10.6.f — Full backfill ignores newestKnown
// --------------------------------------------------------------------------
//
// Same data shape as 10.6.e but mode = "full". Loop must run until
// the empty/short stop conditions fire, regardless of newestKnown.
describe("§10.6.f — full backfill ignores newestKnown", () => {
  test("full mode paginates past newestKnown overlap", async () => {
    const T = "2026-05-19T00:00:00.000Z"
    const TMs = Date.parse(T)

    const page0 = Array.from({ length: 50 }, (_, i) => ({
      id: `usg_f_p0_${i}`,
      timeCreated: new Date(TMs + (i + 1) * 1000).toISOString(),
      cost: 1,
    }))
    const page1 = Array.from({ length: 50 }, (_, i) => ({
      id: `usg_f_p1_${i}`,
      timeCreated: new Date(TMs - (i + 1) * 1000).toISOString(),
      cost: 1,
    }))
    // Page 2 is the natural empty page that stops a full backfill.
    server = installMockServer({ rows: [...page0, ...page1] })
    db = setupDb()

    // Seed DB so newestKnown = T (would stop incremental at page 1).
    db.exec(`
      INSERT INTO zen_usage (id, workspace_id, session_id, key_id, model,
        provider, time_created, time_updated, time_deleted,
        input_tokens, output_tokens, reasoning_tokens, cache_read_tokens,
        cache_write_5m_tokens, cache_write_1h_tokens, cost_fxp8,
        enrichment_json, fetched_at, raw_json)
      VALUES ('usg_seed_T', 'wrk_test', NULL, 'key_test', 'claude-opus-4-7',
        'anthropic', '${T}', '${T}', NULL, 0, 0, NULL, 0, NULL, NULL, 0,
        NULL, '${T}', NULL);
    `)

    const result = await syncAll({
      cookie: "test-cookie",
      config: TEST_CONFIG,
      db,
      mode: "full",
    })
    // Full mode must NOT stop at the newestKnown overlap. It fetches
    // both full pages and then page 2 (which is empty).
    expect(result.pagesFetched).toBe(3)
    expect(server.state.pageCalls).toEqual([0, 1, 2])
  })
})

// --------------------------------------------------------------------------
// §10.6.g — Dedup by id (INSERT OR REPLACE BY id)
// --------------------------------------------------------------------------
//
// The same row id appears in pages 0 and 1 (simulates the offset-shift
// overlap that happens when rows arrive mid-paginate). The DB must end
// up with exactly one copy of that row, and `fetched_at` must reflect
// the more recent upsert.
describe("§10.6.g — dedup by id", () => {
  test("duplicate id across pages becomes a single row", async () => {
    const page0 = makeRows(50, "usg_g_p0")
    // Page 1 starts with a copy of page0's last row (overlap), plus
    // 49 new rows.
    const overlap = page0[page0.length - 1]!
    const page1 = [overlap, ...makeRows(49, "usg_g_p1")]
    server = installMockServer({ rows: [...page0, ...page1] })
    db = setupDb()

    const result = await syncAll({
      cookie: "test-cookie",
      config: TEST_CONFIG,
      db,
      mode: "incremental",
    })
    // Total unique rows: 50 (page0) + 49 (page1 net-new) = 99.
    const count = (db.query("SELECT COUNT(*) AS n FROM zen_usage").get() as any).n
    expect(count).toBe(99)
    // Exactly one row for the overlapping id.
    const overlapRow = db.query(
      "SELECT COUNT(*) AS n FROM zen_usage WHERE id = ?",
    ).get(overlap.id) as any
    expect(overlapRow.n).toBe(1)
    expect(result.fetched).toBeGreaterThanOrEqual(99)
  })
})

// --------------------------------------------------------------------------
// §10.6.h — Safety cap at 1000 pages
// --------------------------------------------------------------------------
//
// Mock returns 50 rows per page forever. Loop must throw at page 1000
// with the specific error message pinned by PLAN §5.2.
describe("§10.6.h — 1000-page safety cap", () => {
  test("throws after 1000 pages without exhausting the source", async () => {
    server = installMockServer({
      rows: [],
      infinite: true,  // unbounded full pages
    })
    db = setupDb()

    await expect(
      syncAll({
        cookie: "test-cookie",
        config: TEST_CONFIG,
        db,
        mode: "full",
      }),
    ).rejects.toThrow(/1000-page safety cap|safety cap/i)

    // The mock should have been called the cap many times — verify
    // the loop actually iterated.
    expect(server.state.fetchCount).toBeGreaterThanOrEqual(1000)
  }, 30_000)  // generous timeout: 1000 fetches × mock cost
})

// --------------------------------------------------------------------------
// §10.6.i — Page-size drift DOWN
// --------------------------------------------------------------------------
//
// If Zen ever shrinks the page size below 50 (e.g. to 30), the
// short-page guard must still fire and exit cleanly. Treat as last page.
describe("§10.6.i — page-size drift down", () => {
  test("30-row page treated as short, loop exits", async () => {
    const rows = makeRows(30)
    server = installMockServer({ rows })
    db = setupDb()
    const result = await syncAll({
      cookie: "test-cookie",
      config: TEST_CONFIG,
      db,
      mode: "incremental",
    })
    expect(result.written).toBe(30)
    expect(result.pagesFetched).toBe(1)
    expect(server.state.pageCalls).toEqual([0])
  })
})

// --------------------------------------------------------------------------
// §10.6.j — Page-size drift UP
// --------------------------------------------------------------------------
//
// If Zen ever grows page size to 100, the loop must accept the larger
// pages and continue (no spurious early stop). The empty-page guard
// catches the end.
describe("§10.6.j — page-size drift up", () => {
  test("100-row pages accepted, loop continues to natural end", async () => {
    const rows = makeRows(200)
    server = installMockServer({ rows, pageSize: 100 })
    db = setupDb()
    const result = await syncAll({
      cookie: "test-cookie",
      config: TEST_CONFIG,
      db,
      mode: "incremental",
    })
    // 100 + 100 + 0 = three fetches.
    expect(result.written).toBe(200)
    expect(result.pagesFetched).toBe(3)
    expect(server.state.pageCalls).toEqual([0, 1, 2])
  })
})

// --------------------------------------------------------------------------
// §10.6.k — Concurrent lock contention (exit 75)
// --------------------------------------------------------------------------
//
// PLAN §5.3: flock(2) advisory exclusive lock at
// ~/.local/state/opencode-cost/zen-sync.lock. Contending caller exits
// code 75 with a diagnostic line identifying the holder PID and start.
//
// Verified at two layers:
//   1. acquireSyncLock returns a release handle on first call, null on
//      second call (same dir, same process).
//   2. runZenSync returns 75 when the lock is held externally.
describe("§10.6.k — concurrent lock contention", () => {
  let lockDir: string

  beforeEach(() => {
    lockDir = mkdtempSync(join(tmpdir(), "zen-sync-lock-"))
  })

  afterEach(() => {
    try {
      rmSync(lockDir, { recursive: true, force: true })
    } catch {}
    delete process.env.OPENCODE_COST_LOCK_DIR
  })

  test("acquireSyncLock contends correctly within one process", async () => {
    const first = await acquireSyncLock(lockDir)
    expect(first).not.toBeNull()
    expect(first!.pid).toBe(process.pid)
    expect(typeof first!.since).toBe("string")

    const second = await acquireSyncLock(lockDir)
    expect(second).toBeNull()

    await first!.release()

    // Lock should be re-acquirable after release.
    const third = await acquireSyncLock(lockDir)
    expect(third).not.toBeNull()
    await third!.release()
  })

  test("runZenSync exits 75 when the lock is held", async () => {
    const held = await acquireSyncLock(lockDir)
    expect(held).not.toBeNull()
    process.env.OPENCODE_COST_LOCK_DIR = lockDir
    try {
      const exitCode = await runZenSync([])
      expect(exitCode).toBe(75)
    } finally {
      await held!.release()
    }
  })
})

// --------------------------------------------------------------------------
// §10.6.l — Mid-sync arrivals (eventual consistency)
// --------------------------------------------------------------------------
//
// After page 0 is fetched, 5 new rows arrive at the source. The current
// run already passed page 0; those 5 rows are NOT picked up this sync.
// They appear at the top of page 0 on the next incremental run (caught
// by MAX(time_created) advancing past them).
describe("§10.6.l — mid-sync arrivals not picked up this run", () => {
  test("5 rows inserted after page 0 fetch are absent from this run's DB", async () => {
    const initial = makeRows(100, "usg_l_initial", "2026-05-19T00:00:00.000Z")
    const newArrivals: MockRow[] = Array.from({ length: 5 }, (_, i) => ({
      id: `usg_l_arrival_${i}`,
      timeCreated: `2026-05-19T01:00:0${i}.000Z`,  // strictly newer than any initial
      cost: 1,
    }))

    server = installMockServer({
      rows: initial,
      afterPage: (page, state) => {
        if (page === 0) {
          // Simulate the 5 mid-sync arrivals appearing at the source.
          state.rows = [...newArrivals, ...state.rows]
        }
      },
    })
    db = setupDb()

    const result = await syncAll({
      cookie: "test-cookie",
      config: TEST_CONFIG,
      db,
      mode: "incremental",
    })

    // The 5 arrivals are NOT in the DB this run.
    const arrivalsInDb = db
      .query("SELECT COUNT(*) AS n FROM zen_usage WHERE id LIKE 'usg_l_arrival_%'")
      .get() as any
    expect(arrivalsInDb.n).toBe(0)

    // Initial 100 ARE in the DB (page 0 grabbed 50, page 1 grabbed
    // initial[45..94] because newArrivals shifted indices — but
    // INSERT OR REPLACE BY id collapses overlaps to unique ids).
    const initialInDb = db
      .query("SELECT COUNT(*) AS n FROM zen_usage WHERE id LIKE 'usg_l_initial_%'")
      .get() as any
    expect(initialInDb.n).toBeGreaterThan(0)
    expect(initialInDb.n).toBeLessThanOrEqual(100)

    // pagesFetched tracks what actually went out — confirms the run
    // exited normally (didn't loop forever chasing the arrivals).
    expect(result.pagesFetched).toBeGreaterThanOrEqual(1)
  })
})
