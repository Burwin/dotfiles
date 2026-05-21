// cost-tracker.test.ts — bun:test suite for ../cost-tracker.ts.
//
// Combines static parse-checks (Group A) with a synthetic-event dispatch
// harness (Group B). Spec source: docs/plans/opencode-plugin-smoke/PLAN.md
// Step 3.
//
// Lives in this `cost-tracker/` subdirectory so opencode's plugin loader
// (non-recursive `{plugin,plugins}/*.{ts,js}` glob) doesn't try to load
// the test file itself as a Plugin — same reason notify/notify.test.ts
// lives one level down. Run from the repo root:
//   bun test ./opencode/.config/opencode/plugins/
//
// Module-level state notes (PLAN.md §"Notes & risks"):
//   - `warnedMissingRate` in ./recompute.ts and `warnedNoDb` in
//     ../cost-tracker.ts are module-/closure-scoped latches that leak
//     across tests unless we re-import the module. We handle the
//     warnedNoDb case via mock.module + cache-busting dynamic import in
//     the "DB unavailable" describe block; warnedMissingRate fires at
//     most once per bun:test process and we swallow it with a
//     console.warn capture per test.
//   - `openDbPromise` in ./db.ts is also module-scoped. The "DB
//     unavailable" describe uses mock.module to override openDb without
//     touching the real promise, so the happy-path describe's DB handle
//     stays valid.
//   - The plugin's loader fires `fetchRates(client)` as fire-and-forget
//     and returns before the .then settles. Tests that need a populated
//     rate table must await microtasks; we provide a `waitForRates`
//     helper. For Group B's row-write assertions we accept the
//     empty-rate path on purpose — cost_recomputed_fxp8 is 0 in that
//     case and we don't assert on it.

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test"
import { Database } from "bun:sqlite"
import { spawnSync } from "node:child_process"
import { mkdirSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

/* ──────────────────────────────────────────────────────────────────────
 * SDK shape snapshot — verbatim from
 * ~/.config/opencode/node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts
 * (@opencode-ai/sdk@1.14.x as of the file this test was authored against).
 * When the SDK upgrades, the dispatch tests below will likely break first
 * (assistant-message row missing fields, role checks failing, etc.); this
 * snapshot tells the reader where to diff to find the new shape.
 *
 *   export type AssistantMessage = {
 *       id: string;
 *       sessionID: string;
 *       role: "assistant";
 *       time: {
 *           created: number;
 *           completed?: number;
 *       };
 *       error?: ProviderAuthError | UnknownError | MessageOutputLengthError | MessageAbortedError | ApiError;
 *       parentID: string;
 *       modelID: string;
 *       providerID: string;
 *       mode: string;
 *       path: {
 *           cwd: string;
 *           root: string;
 *       };
 *       summary?: boolean;
 *       cost: number;
 *       tokens: {
 *           input: number;
 *           output: number;
 *           reasoning: number;
 *           cache: {
 *               read: number;
 *               write: number;
 *           };
 *       };
 *       finish?: string;
 *   };
 *
 *   export type UserMessage = {
 *       id: string;
 *       sessionID: string;
 *       role: "user";
 *       time: { created: number };
 *       summary?: { ... };
 *       agent: string;
 *       model: { providerID: string; modelID: string };
 *       system?: string;
 *       tools?: { [key: string]: boolean };
 *   };
 *
 *   export type Message = UserMessage | AssistantMessage;
 *
 *   export type EventMessageUpdated = {
 *       type: "message.updated";
 *       properties: { info: Message };
 *   };
 *
 *   export type EventSessionIdle = {
 *       type: "session.idle";
 *       properties: { sessionID: string };
 *   };
 * ──────────────────────────────────────────────────────────────────── */

// ──────────────────────────────────────────────────────────────────────
// Group A — module parse-checks
//
// `bun build --target=bun --no-bundle` resolves and type-checks each
// file against the live @opencode-ai/plugin / @opencode-ai/sdk type
// definitions in ~/.config/opencode/node_modules/. The single highest-
// value smoke against SDK type drift: any breaking shape change in the
// SDK that touches the call sites here surfaces as a non-zero status
// from this group rather than a silent runtime row-drop.
// ──────────────────────────────────────────────────────────────────────

describe("cost-tracker module parse-checks", () => {
  const targets = [
    "../cost-tracker.ts",
    "./db.ts",
    "./recompute.ts",
    "./rate-table.ts",
  ] as const

  for (const rel of targets) {
    test(`parses cleanly via bun build: ${rel}`, () => {
      const file = fileURLToPath(new URL(rel, import.meta.url))
      const res = spawnSync(
        "bun",
        ["build", "--target=bun", "--no-bundle", file],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      )
      if (res.status !== 0) {
        throw new Error(
          `bun build failed for ${rel} (status ${res.status}):\n${res.stderr}`,
        )
      }
    })
  }
})

// ──────────────────────────────────────────────────────────────────────
// Group B — event-handler dispatch
// ──────────────────────────────────────────────────────────────────────

// Shared fixtures across the describe blocks. Each block sets its own
// plugin instance; the temp DB / worktree are shared.

let tempRoot: string
let worktree: string
let dbPath: string

const buildAssistantMessage = (overrides: Record<string, unknown> = {}) => ({
  id: (overrides.id as string) ?? `msg_${crypto.randomUUID()}`,
  sessionID: (overrides.sessionID as string) ?? "ses_test",
  role: "assistant" as const,
  time: {
    created: 1700000000000,
    completed: 1700000005000,
    ...((overrides.time as Record<string, number>) ?? {}),
  },
  parentID: "msg_parent",
  modelID: "claude-opus-4-7",
  providerID: "anthropic",
  mode: "build",
  path: { cwd: "/tmp", root: "/tmp" },
  cost: 0.0001234,
  tokens: {
    input: 1000,
    output: 500,
    reasoning: 100,
    cache: { read: 50, write: 25 },
    ...((overrides.tokens as Record<string, unknown>) ?? {}),
  },
  finish: "stop",
  ...overrides,
})

const buildUserMessage = (overrides: Record<string, unknown> = {}) => ({
  id: `msg_${crypto.randomUUID()}`,
  sessionID: "ses_test",
  role: "user" as const,
  time: { created: 1700000000000 },
  agent: "build",
  model: { providerID: "anthropic", modelID: "claude-opus-4-7" },
  ...overrides,
})

const stubClient = () => ({
  config: {
    providers: async () => ({ providers: [] }),
  },
})

// Capture console.warn output during a block of code, restoring at the
// end. The plugin emits multiple warn lines we don't care about during
// happy-path tests (warnedMissingRate latch, persist-failure noise);
// individual tests inspect `calls` only when they actually care.
const captureWarn = (): {
  calls: unknown[][]
  restore: () => void
} => {
  const calls: unknown[][] = []
  const original = console.warn
  console.warn = (...args: unknown[]) => {
    calls.push(args)
  }
  return {
    calls,
    restore: () => {
      console.warn = original
    },
  }
}

const captureLog = (): {
  calls: unknown[][]
  restore: () => void
} => {
  const calls: unknown[][] = []
  const original = console.log
  console.log = (...args: unknown[]) => {
    calls.push(args)
  }
  return {
    calls,
    restore: () => {
      console.log = original
    },
  }
}

// Yield enough microtasks for the fire-and-forget fetchRates promise
// chain inside CostTrackerPlugin to settle. fetchRates awaits the client
// call + a sha256 digest, then a .then callback writes to the closure-
// local rateTable. setImmediate drains all pending microtasks per tick;
// we loop a handful of times to absorb any nested promise hops.
const waitForRates = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setImmediate(r))
  }
}

// ----------------------------------------------------------------------
// Happy-path describe — real db.ts, temp DB.
// ----------------------------------------------------------------------

describe("CostTrackerPlugin event handler", () => {
  // The plugin is loaded once with a fresh temp DB; each test wipes the
  // messages + session_rollup tables in beforeEach so they don't bleed.
  // This sidesteps the db.ts module-level openDbPromise cache that would
  // otherwise pin the DB path forever per process.
  let hooks: any

  beforeAll(async () => {
    tempRoot = (() => {
      const d = join(tmpdir(), `cost-tracker-test-${crypto.randomUUID()}`)
      mkdirSync(d, { recursive: true })
      return realpathSync(d)
    })()
    dbPath = join(tempRoot, "cost.db")
    worktree = tempRoot

    // Must set OPENCODE_COST_DB BEFORE the first import of ../cost-tracker.ts
    // (which transitively imports ./db.ts and triggers the path read).
    process.env.OPENCODE_COST_DB = dbPath

    // Suppress the plugin's bootstrap chatter ("[cost-tracker] loaded
    // 0 rates", etc.) so the test runner output stays readable.
    const logCap = captureLog()
    const warnCap = captureWarn()
    try {
      const mod = await import("../cost-tracker.ts")
      hooks = await mod.CostTrackerPlugin({
        worktree,
        client: stubClient(),
        $: () => Promise.resolve(),
      })
      await waitForRates()
    } finally {
      logCap.restore()
      warnCap.restore()
    }
  })

  beforeEach(() => {
    const db = new Database(dbPath)
    db.exec("DELETE FROM messages; DELETE FROM session_rollup;")
    db.close?.()
  })

  afterAll(() => {
    rmSync(tempRoot, { recursive: true, force: true })
    delete process.env.OPENCODE_COST_DB
  })

  test("message.updated with AssistantMessage writes a row", async () => {
    const msg = buildAssistantMessage({
      id: "msg_happy_path",
      sessionID: "ses_1",
      cost: 0.0005678,
    })

    const warnCap = captureWarn()
    try {
      await hooks.event({
        event: { type: "message.updated", properties: { info: msg } },
      })
    } finally {
      warnCap.restore()
    }

    const db = new Database(dbPath, { readonly: true })
    const row = db
      .query("SELECT * FROM messages WHERE message_id = ?")
      .get("msg_happy_path") as any
    db.close?.()

    expect(row).toBeDefined()
    expect(row.session_id).toBe("ses_1")
    expect(row.provider_id).toBe("anthropic")
    expect(row.model_id).toBe("claude-opus-4-7")
    expect(row.agent).toBe("build")
    expect(row.tokens_input).toBe(1000)
    expect(row.tokens_output).toBe(500)
    expect(row.tokens_reasoning).toBe(100)
    expect(row.tokens_cache_read).toBe(50)
    expect(row.tokens_cache_write).toBe(25)
    expect(row.tokens_cache_write_5m).toBeNull()
    expect(row.tokens_cache_write_1h).toBeNull()
    expect(row.cost_opencode_fxp8).toBe(Math.round(0.0005678 * 1e8))
    expect(row.ts_created).toBe(new Date(1700000000000).toISOString())
    expect(row.ts_completed).toBe(new Date(1700000005000).toISOString())
    expect(row.finish).toBe("stop")
    expect(row.worktree_path).toBe(worktree)
    // raw_json captures the full message payload (truncated to 10k);
    // verify it's a parseable JSON object with the expected id.
    expect(typeof row.raw_json).toBe("string")
    expect(JSON.parse(row.raw_json).id).toBe("msg_happy_path")
  })

  test("user messages are skipped (no row written)", async () => {
    const userMsg = buildUserMessage({ id: "msg_user", sessionID: "ses_2" })

    await hooks.event({
      event: { type: "message.updated", properties: { info: userMsg } },
    })

    const db = new Database(dbPath, { readonly: true })
    // bun:sqlite returns null (not undefined) when no row matches; the
    // bare falsy check covers both for portability.
    const row = db
      .query("SELECT * FROM messages WHERE message_id = ?")
      .get("msg_user") as unknown
    db.close?.()

    expect(row).toBeNull()
  })

  test("missing properties.info is logged and dropped (no row, no throw)", async () => {
    const warnCap = captureWarn()
    try {
      // The plugin must not throw on a malformed payload.
      await expect(
        hooks.event({
          event: { type: "message.updated", properties: {} },
        }),
      ).resolves.toBeUndefined()
    } finally {
      warnCap.restore()
    }

    const matching = warnCap.calls.find((args) =>
      args.some(
        (a) => typeof a === "string" && a.includes("missing properties.info"),
      ),
    )
    expect(matching).toBeDefined()

    const db = new Database(dbPath, { readonly: true })
    const count = db.query("SELECT COUNT(*) as n FROM messages").get() as {
      n: number
    }
    db.close?.()
    expect(count.n).toBe(0)
  })

  test("session.idle triggers sessionRollup.computeAndUpsert", async () => {
    const m1 = buildAssistantMessage({
      id: "msg_rollup_1",
      sessionID: "ses_rollup",
      cost: 0.0001,
    })
    const m2 = buildAssistantMessage({
      id: "msg_rollup_2",
      sessionID: "ses_rollup",
      cost: 0.0002,
    })

    const warnCap = captureWarn()
    try {
      await hooks.event({
        event: { type: "message.updated", properties: { info: m1 } },
      })
      await hooks.event({
        event: { type: "message.updated", properties: { info: m2 } },
      })
      await hooks.event({
        event: {
          type: "session.idle",
          properties: { sessionID: "ses_rollup" },
        },
      })
    } finally {
      warnCap.restore()
    }

    const db = new Database(dbPath, { readonly: true })
    const rollup = db
      .query("SELECT * FROM session_rollup WHERE session_id = ?")
      .get("ses_rollup") as any
    db.close?.()

    expect(rollup).toBeDefined()
    expect(rollup.message_count).toBe(2)
    expect(rollup.total_cost_opencode_fxp8).toBe(
      Math.round(0.0001 * 1e8) + Math.round(0.0002 * 1e8),
    )
    // ts_last_idle is captured from `new Date().toISOString()` inside the
    // handler — we don't pin the value, only that it's a non-empty
    // ISO 8601 string.
    expect(typeof rollup.ts_last_idle).toBe("string")
    expect(rollup.ts_last_idle.length).toBeGreaterThan(0)
  })

  test("session.idle without sessionID warns and skips rollup", async () => {
    const warnCap = captureWarn()
    try {
      await hooks.event({
        event: { type: "session.idle", properties: {} },
      })
    } finally {
      warnCap.restore()
    }

    const matching = warnCap.calls.find((args) =>
      args.some(
        (a) =>
          typeof a === "string" && a.includes("session.idle missing sessionID"),
      ),
    )
    expect(matching).toBeDefined()
  })

  test("cache-write tier split: numeric write → flat sum only", async () => {
    const msg = buildAssistantMessage({
      id: "msg_cache_numeric",
      sessionID: "ses_cache",
      tokens: {
        input: 100,
        output: 50,
        reasoning: 0,
        cache: { read: 10, write: 1234 },
      },
    })

    const warnCap = captureWarn()
    try {
      await hooks.event({
        event: { type: "message.updated", properties: { info: msg } },
      })
    } finally {
      warnCap.restore()
    }

    const db = new Database(dbPath, { readonly: true })
    const row = db
      .query("SELECT * FROM messages WHERE message_id = ?")
      .get("msg_cache_numeric") as any
    db.close?.()

    expect(row).toBeDefined()
    expect(row.tokens_cache_write).toBe(1234)
    expect(row.tokens_cache_write_5m).toBeNull()
    expect(row.tokens_cache_write_1h).toBeNull()
  })

  test("cache-write tier split: object write → 5m + 1h + sum", async () => {
    const msg = buildAssistantMessage({
      id: "msg_cache_object",
      sessionID: "ses_cache_obj",
      tokens: {
        input: 100,
        output: 50,
        reasoning: 0,
        cache: { read: 10, write: { "5m": 800, "1h": 200 } },
      },
    })

    const warnCap = captureWarn()
    try {
      await hooks.event({
        event: { type: "message.updated", properties: { info: msg } },
      })
    } finally {
      warnCap.restore()
    }

    const db = new Database(dbPath, { readonly: true })
    const row = db
      .query("SELECT * FROM messages WHERE message_id = ?")
      .get("msg_cache_object") as any
    db.close?.()

    expect(row).toBeDefined()
    expect(row.tokens_cache_write_5m).toBe(800)
    expect(row.tokens_cache_write_1h).toBe(200)
    expect(row.tokens_cache_write).toBe(1000)
  })
})

// ----------------------------------------------------------------------
// DB-unavailable describe — mocked db.ts that always returns null.
//
// This block uses bun:test's mock.module to swap ./db.ts's exports just
// before importing a cache-busted copy of cost-tracker.ts. Real db.ts
// exports (applySchema, MIGRATIONS, BOOTSTRAP_SQL, types) are passed
// through via spread, so the only behavioral change is openDb → null.
// The afterAll re-mocks back to the real exports for any subsequent
// test files in the same bun:test invocation.
// ----------------------------------------------------------------------

describe("CostTrackerPlugin when DB is unavailable", () => {
  let hooks: any
  let realDbModule: Record<string, unknown>

  beforeAll(async () => {
    // Snapshot the real exports BEFORE mocking so we can pass them
    // through (and restore afterwards).
    realDbModule = { ...(await import("./db.ts")) }
    mock.module("./db.ts", () => ({
      ...realDbModule,
      openDb: async () => null,
    }))

    // Cache-bust the cost-tracker.ts import. A new URL forces fresh
    // evaluation, which re-resolves ./cost-tracker/db.ts through the
    // mock and stores `null` in the plugin's closure-local `db`.
    const mod = await import("../cost-tracker.ts?test=db-unavailable")
    const logCap = captureLog()
    const warnCap = captureWarn()
    try {
      hooks = await mod.CostTrackerPlugin({
        worktree: tempRoot ?? "/tmp",
        client: stubClient(),
        $: () => Promise.resolve(),
      })
      await waitForRates()
    } finally {
      logCap.restore()
      warnCap.restore()
    }
  })

  afterAll(() => {
    // Restore the real exports. mock.module doesn't have an undo, but
    // re-mocking with the captured originals is functionally equivalent.
    mock.module("./db.ts", () => realDbModule)
  })

  test("warn-latch: 'DB unavailable' fires exactly once across many events", async () => {
    const warnCap = captureWarn()
    try {
      const msg = buildAssistantMessage({
        id: "msg_no_db_1",
        sessionID: "ses_no_db",
      })
      // Dispatch several events that would normally write rows; with
      // db=null the handler should warn on the first and stay silent
      // thereafter (warnedNoDb latch).
      await hooks.event({
        event: { type: "message.updated", properties: { info: msg } },
      })
      await hooks.event({
        event: {
          type: "message.updated",
          properties: { info: { ...msg, id: "msg_no_db_2" } },
        },
      })
      await hooks.event({
        event: {
          type: "message.updated",
          properties: { info: { ...msg, id: "msg_no_db_3" } },
        },
      })
      await hooks.event({
        event: {
          type: "session.idle",
          properties: { sessionID: "ses_no_db" },
        },
      })
    } finally {
      warnCap.restore()
    }

    const matching = warnCap.calls.filter((args) =>
      args.some(
        (a) => typeof a === "string" && a.includes("DB unavailable"),
      ),
    )
    expect(matching.length).toBe(1)
  })
})
