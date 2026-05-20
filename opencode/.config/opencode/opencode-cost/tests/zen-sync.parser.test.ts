// opencode-cost/tests/zen-sync.parser.test.ts — Z0' RED scaffolds for the
// per-row Zen `_server` response parser.
//
// Acceptance contract: ../../../../docs/plans/opencode-cost-pertask-tmux-status/PLAN.md
// §10.7.a through §10.7.i.
//
// Status when this file lands (Commit 3): RED. The new per-row entry point
// `parseUsageList` does not yet exist in zen-sync.ts — Z0 introduces it in
// Commit 4 along with the `new Date(...)` literal extension to the static
// $R[n] parser. Every assertion in this file is meant to pin the contract
// before the production code is touched; running `bun test` against this
// file today is expected to fail at the import site (undefined function)
// or at first call to the missing API.
//
// What `parseUsageList` is supposed to do (Z0):
//   1. Strip the `;0xHEX;` chunked-stream prefixes (already in zen-sync.ts).
//   2. Run the static $R[n] parser over the body (already in zen-sync.ts)
//      with one new prefix in the value parser: recognize
//      `new Date("ISO")` and surface the ISO string as the value.
//   3. Walk $R[0] (expected to be an Array<RowObject>), normalize each
//      row into a typed ZenUsageRowFull, and return them.
//   4. Unknown fields on a row collect under `enrichment` (per PLAN §4.1
//      `enrichment_json` forward-compat decision; §10.7.f pins this).
//
// What stays in zen-sync.ts unchanged:
//   - The existing `parseServerResponse(body): unknown` low-level entry
//     point. Tests still import it for the eval-escape-hatch case (10.7.i).
//
// Run from the repo root:
//   bun test ./opencode/.config/opencode/opencode-cost/tests/zen-sync.parser.test.ts
//
// Fixtures: ./fixtures/parser/*.txt — each is the body of a synthetic
// _server response in the same JS-literal-subset format Zen returns.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

// IMPORTANT: `parseUsageList` and the `ZenUsageRowFull` type are Z0's
// new exports. They do NOT exist in zen-sync.ts yet. We use a namespace
// import so module loading succeeds (rather than failing the whole file
// at parse time on a named-import miss); the missing functions resolve
// to `undefined` and each individual test fails when it calls them.
// That's the intended RED signal — Commit 4's GREEN delivery flips this
// suite to passing.
import * as zenSync from "../zen-sync.ts"

// Type stub: the real `ZenUsageRowFull` type ships in Commit 4. Mirror
// the expected shape here so the assertions read naturally; Commit 4
// either matches it or makes the necessary deltas explicit.
type ZenUsageRowFull = {
  id: string
  workspaceId: string
  sessionId: string | null
  keyId: string
  model: string
  provider: string
  timeCreated: string         // ISO 8601
  timeUpdated: string
  timeDeleted: string | null
  inputTokens: number
  outputTokens: number
  reasoningTokens: number | null
  cacheReadTokens: number
  cacheWrite5mTokens: number | null
  cacheWrite1hTokens: number | null
  cost: number                // fxp8 (matches schema cost_fxp8)
  enrichment: Record<string, unknown> | null
}

const parseUsageList = (body: string): ZenUsageRowFull[] => {
  const fn = (zenSync as any).parseUsageList
  if (typeof fn !== "function") {
    throw new Error(
      "zen-sync.ts does not yet export parseUsageList — Z0 is unstarted " +
      "(PLAN.md §9 Commit 4 / P4.0).",
    )
  }
  return fn(body) as ZenUsageRowFull[]
}

const parseServerResponse = (body: string): unknown =>
  (zenSync as any).parseServerResponse(body)

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "parser")
const loadFixture = (name: string): string =>
  readFileSync(join(FIXTURES_DIR, name), "utf8")

// --------------------------------------------------------------------------
// §10.7.a — `new Date("...")` literals surface as ISO 8601 strings
// --------------------------------------------------------------------------
//
// Per-row Zen responses include `timeCreated`, `timeUpdated`, and
// occasionally `timeDeleted` as `new Date(...)` literals (seroval emits
// `Date` instances this way). The existing parser does not recognize
// this prefix and either drops the value or throws on `new`. Z0 must
// extend the value parser to consume `new Date("ISO")` and surface the
// ISO string as the row field value.
describe("§10.7.a — new Date() literal recognition", () => {
  test("timeCreated round-trips to the original ISO string", () => {
    const body = loadFixture("new-date.txt")
    const rows = parseUsageList(body)
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.timeCreated).toBe("2026-05-19T23:22:58.000Z")
    expect(typeof row.timeCreated).toBe("string")
  })

  test("timeUpdated with sub-second precision round-trips", () => {
    const body = loadFixture("new-date.txt")
    const rows = parseUsageList(body)
    expect(rows[0]!.timeUpdated).toBe("2026-05-19T23:23:00.500Z")
  })

  test("timeDeleted = null stays null (no spurious Date wrap)", () => {
    const body = loadFixture("new-date.txt")
    const rows = parseUsageList(body)
    expect(rows[0]!.timeDeleted).toBeNull()
  })
})

// --------------------------------------------------------------------------
// §10.7.b — Shared $R[N] back-references preserve instance equality
// --------------------------------------------------------------------------
//
// seroval emits repeated values (strings, objects) as a single slot
// referenced from multiple positions. The parsed graph must preserve
// instance equality where the source preserved it — two rows pointing at
// $R[3] (an object) must end up holding the same JS object reference, so
// the rest of the pipeline can detect deduplication opportunities and so
// that future shape evolution doesn't silently break the contract.
describe("§10.7.b — shared $R[N] back-refs", () => {
  test("string slot referenced twice yields equal values", () => {
    // Strings are immutable so reference equality on primitives doesn't
    // mean much, but value-equality should hold trivially.
    const body = loadFixture("back-refs.txt")
    const rows = parseUsageList(body)
    expect(rows).toHaveLength(2)
    expect(rows[0]!.model).toBe("claude-opus-4-7")
    expect(rows[1]!.model).toBe("claude-opus-4-7")
    expect(rows[0]!.sessionId).toBe("ses_shared_back_ref")
    expect(rows[1]!.sessionId).toBe("ses_shared_back_ref")
  })

  test("object slot referenced from two rows is the SAME instance", () => {
    // routing: $R[3] is referenced from both rows. The normalizer surfaces
    // it under `enrichment.routing` (it's not a known schema field). The
    // two enrichment.routing values MUST be the same object reference,
    // not two structurally-equal copies.
    const body = loadFixture("back-refs.txt")
    const rows = parseUsageList(body)
    const a = rows[0]!.enrichment?.routing
    const b = rows[1]!.enrichment?.routing
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    expect(a).toBe(b)  // reference equality
    expect(a).toEqual({ apiBase: "https://api.example", region: "us-east-1" })
  })
})

// --------------------------------------------------------------------------
// §10.7.c — Chunked stream prefixes
// --------------------------------------------------------------------------
//
// Zen's `_server` body uses `;0xHEX;` markers between chunks (custom
// framing, not standard HTTP chunked transfer). The parser must produce
// byte-identical row arrays whether the prefix appears at the start,
// between rows, or not at all.
describe("§10.7.c — chunked stream prefixes", () => {
  test("prefix-none and prefix-start parse identically", () => {
    const none = parseUsageList(loadFixture("chunked-prefix-none.txt"))
    const start = parseUsageList(loadFixture("chunked-prefix-start.txt"))
    expect(start).toEqual(none)
    expect(start).toHaveLength(2)
  })

  test("prefix-none and prefix-mid parse identically", () => {
    const none = parseUsageList(loadFixture("chunked-prefix-none.txt"))
    const mid = parseUsageList(loadFixture("chunked-prefix-mid.txt"))
    expect(mid).toEqual(none)
    expect(mid).toHaveLength(2)
  })

  test("all three variants produce equal rows in equal order", () => {
    const none = parseUsageList(loadFixture("chunked-prefix-none.txt"))
    const start = parseUsageList(loadFixture("chunked-prefix-start.txt"))
    const mid = parseUsageList(loadFixture("chunked-prefix-mid.txt"))
    expect(none.map((r) => r.id)).toEqual(["usg_c1", "usg_c2"])
    expect(start.map((r) => r.id)).toEqual(["usg_c1", "usg_c2"])
    expect(mid.map((r) => r.id)).toEqual(["usg_c1", "usg_c2"])
  })
})

// --------------------------------------------------------------------------
// §10.7.d — Empty $R[0] = []
// --------------------------------------------------------------------------
//
// An empty page is a legitimate end-of-stream signal. The parser MUST
// return an empty array rather than null/undefined/throw.
describe("§10.7.d — empty rows array", () => {
  test("returns empty array, no error", () => {
    const body = loadFixture("empty-rows.txt")
    const rows = parseUsageList(body)
    expect(Array.isArray(rows)).toBe(true)
    expect(rows).toHaveLength(0)
  })
})

// --------------------------------------------------------------------------
// §10.7.e — Missing $R[0]
// --------------------------------------------------------------------------
//
// If the response somehow doesn't assign $R[0] at all (a fundamental
// shape change, not a normal empty page), the parser must throw loudly
// rather than silently returning [] — that would mask a deploy-time
// breakage as "no new rows" forever.
describe("§10.7.e — missing root assignment", () => {
  test("throws when $R[0] is never assigned", () => {
    const body = loadFixture("missing-root.txt")
    expect(() => parseUsageList(body)).toThrow(/\$R\[0\]/)
  })

  test("error message names $R[0] specifically", () => {
    // The thrown error must reference the missing root slot by name so
    // an operator reading the log can immediately recognize the shape
    // failure mode (vs. a generic "parse error"). The phrasing must be
    // specific enough to distinguish from the placeholder error the
    // RED scaffold raises ("does not yet export"). Existing low-level
    // parser uses "did not assign $R[0]"; the Z0 entry point should
    // adopt the same wording or one of these recognized variants.
    const body = loadFixture("missing-root.txt")
    try {
      parseUsageList(body)
      expect.unreachable("expected throw")
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      expect(msg).toMatch(/did not assign \$R\[0\]|\$R\[0\] (?:was )?(?:not|never) assigned|missing root \$R\[0\]/i)
    }
  })
})

// --------------------------------------------------------------------------
// §10.7.f — Shape drift (new field) → surface under `enrichment`
// --------------------------------------------------------------------------
//
// First-run decision (per PLAN §10.7.f "Test pins whichever we pick"):
// **forward-compat via `enrichment_json`** — unknown row fields are
// preserved on the parsed row under `enrichment: Record<string, unknown>`.
// The sync layer (Z3) serializes that map to JSON and stores it in the
// `enrichment_json` column. Rationale: schema §4.1 explicitly carries an
// `enrichment_json` slot "forward-compat"; this is the test that pins it.
describe("§10.7.f — shape drift (forward-compat)", () => {
  test("known fields populate the typed schema slots", () => {
    const body = loadFixture("shape-drift.txt")
    const rows = parseUsageList(body)
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.id).toBe("usg_drift")
    expect(row.cost).toBe(1000)
    expect(row.model).toBe("claude-opus-4-7")
  })

  test("unknown top-level fields land under enrichment", () => {
    const body = loadFixture("shape-drift.txt")
    const row = parseUsageList(body)[0]!
    expect(row.enrichment).not.toBeNull()
    expect(row.enrichment).toMatchObject({
      surgeMultiplier: 1.5,
      planTier: "pro",
      abTestVariant: "variant-b",
    })
  })

  test("enrichment does NOT contain known schema fields", () => {
    // Avoid double-counting: `cost`, `model`, `id`, etc. must not also
    // appear under `enrichment`. Round-trip through JSON.stringify would
    // otherwise inflate the column.
    const body = loadFixture("shape-drift.txt")
    const row = parseUsageList(body)[0]!
    const en = row.enrichment ?? {}
    expect(en).not.toHaveProperty("id")
    expect(en).not.toHaveProperty("cost")
    expect(en).not.toHaveProperty("model")
    expect(en).not.toHaveProperty("timeCreated")
  })
})

// --------------------------------------------------------------------------
// §10.7.g — Numeric edge cases
// --------------------------------------------------------------------------
//
// Zero, negatives (defensive — shouldn't appear in real Zen data but
// must not coerce), floats (real for some provider rows pre-rounding),
// exponential literals (Zen seroval may emit these), and nulls for
// nullable fields (reasoning / cache_5m / cache_1h are null on
// fireworks). All MUST round-trip exactly.
describe("§10.7.g — numeric edges", () => {
  const loadEdges = () => parseUsageList(loadFixture("numeric-edges.txt"))

  test("zero values round-trip", () => {
    const rows = loadEdges()
    const zero = rows.find((r) => r.id === "usg_zero")!
    expect(zero.inputTokens).toBe(0)
    expect(zero.outputTokens).toBe(0)
    expect(zero.reasoningTokens).toBe(0)
    expect(zero.cacheReadTokens).toBe(0)
    expect(zero.cacheWrite5mTokens).toBe(0)
    expect(zero.cacheWrite1hTokens).toBe(0)
    expect(zero.cost).toBe(0)
  })

  test("negative values round-trip", () => {
    const rows = loadEdges()
    const neg = rows.find((r) => r.id === "usg_neg")!
    expect(neg.inputTokens).toBe(-1)
    expect(neg.outputTokens).toBe(-2)
    expect(neg.reasoningTokens).toBe(-3)
    expect(neg.cacheReadTokens).toBe(-4)
    expect(neg.cacheWrite5mTokens).toBe(-5)
    expect(neg.cacheWrite1hTokens).toBe(-6)
    expect(neg.cost).toBe(-100)
  })

  test("float cost round-trips (no integer truncation)", () => {
    const rows = loadEdges()
    const flt = rows.find((r) => r.id === "usg_float")!
    expect(flt.cost).toBe(1.5)
  })

  test("exponential literal cost round-trips to expanded number", () => {
    const rows = loadEdges()
    const exp = rows.find((r) => r.id === "usg_exp")!
    expect(exp.cost).toBe(1e8)
    expect(exp.cost).toBe(100000000)
  })

  test("null for nullable fields stays null (no 0 coercion)", () => {
    const rows = loadEdges()
    const nul = rows.find((r) => r.id === "usg_nullable")!
    expect(nul.reasoningTokens).toBeNull()
    expect(nul.cacheWrite5mTokens).toBeNull()
    expect(nul.cacheWrite1hTokens).toBeNull()
  })
})

// --------------------------------------------------------------------------
// §10.7.h — String escape sequences
// --------------------------------------------------------------------------
//
// The static parser decodes JS string escapes (\n \t \" \\). The
// per-row normalizer must not re-escape or strip them; round-trip
// fidelity is the contract.
describe("§10.7.h — string escapes", () => {
  test("\\n and \\t decode to literal newline and tab", () => {
    const body = loadFixture("string-escapes.txt")
    const row = parseUsageList(body)[0]!
    expect(row.model).toBe("line1\nline2\ttabbed")
  })

  test('\\" and \\\\ decode to literal quote and backslash', () => {
    const body = loadFixture("string-escapes.txt")
    const row = parseUsageList(body)[0]!
    expect(row.provider).toBe('with"quote\\and\\backslash')
  })
})

// --------------------------------------------------------------------------
// §10.7.i — No eval / Function escape hatch
// --------------------------------------------------------------------------
//
// The static parser must never delegate evaluation of the response body
// to the JS runtime. Even if the body contains an IIFE wrapper that would
// only execute via `eval(body)` or `new Function(body)`, the parser must
// extract the same data via static walking. We assert this by replacing
// `globalThis.eval` and `globalThis.Function` with spies and confirming
// neither was invoked while parsing the IIFE fixture.
describe("§10.7.i — no eval / Function escape hatch", () => {
  test("parseUsageList never invokes eval() or new Function()", () => {
    const body = loadFixture("iife-eval-attempt.txt")
    const originalEval = globalThis.eval
    const originalFunction = globalThis.Function
    let evalCalls = 0
    let functionCalls = 0
    ;(globalThis as any).eval = (...args: unknown[]) => {
      evalCalls++
      return (originalEval as any).apply(globalThis, args)
    }
    ;(globalThis as any).Function = function (...args: unknown[]) {
      functionCalls++
      return (originalFunction as any).apply(this, args)
    } as any
    try {
      const rows = parseUsageList(body)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe("usg_iife")
      expect(rows[0]!.cost).toBe(42)
    } finally {
      ;(globalThis as any).eval = originalEval
      ;(globalThis as any).Function = originalFunction
    }
    expect(evalCalls).toBe(0)
    expect(functionCalls).toBe(0)
  })

  test("parseUsageList tolerates IIFE wrapper without delegating to eval", () => {
    // The IIFE wrapper fixture would only execute correctly via eval()
    // or `new Function()`. The static parser must produce the same row
    // (id=usg_iife, cost=42) by walking the literal subset — confirming
    // the wrapper is descended into structurally, not invoked. (Cross-
    // check against the eval/Function spy above.)
    const body = loadFixture("iife-eval-attempt.txt")
    const rows = parseUsageList(body)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe("usg_iife")
    expect(rows[0]!.cost).toBe(42)
  })
})

// --------------------------------------------------------------------------
// Type-shape sanity (compile-time pinning)
// --------------------------------------------------------------------------
//
// This block doesn't assert behavior — it pins the TypeScript surface so
// that Z0/Z3 implementers can't accidentally rename a field or drop a
// schema slot without the test file complaining.
describe("ZenUsageRowFull shape", () => {
  test("row carries every schema column declared in PLAN §4.1", () => {
    const body = loadFixture("new-date.txt")
    const rows = parseUsageList(body)
    const row: ZenUsageRowFull = rows[0]!
    // Touch every field so the type checker pins their existence and
    // (broadly) their kind. The runtime values are exercised by the
    // section-specific tests above.
    expect(typeof row.id).toBe("string")
    expect(typeof row.workspaceId).toBe("string")
    expect(typeof row.sessionId === "string" || row.sessionId === null).toBe(true)
    expect(typeof row.keyId).toBe("string")
    expect(typeof row.model).toBe("string")
    expect(typeof row.provider).toBe("string")
    expect(typeof row.timeCreated).toBe("string")
    expect(typeof row.timeUpdated).toBe("string")
    expect(typeof row.timeDeleted === "string" || row.timeDeleted === null).toBe(true)
    expect(typeof row.inputTokens).toBe("number")
    expect(typeof row.outputTokens).toBe("number")
    expect(typeof row.reasoningTokens === "number" || row.reasoningTokens === null).toBe(true)
    expect(typeof row.cacheReadTokens).toBe("number")
    expect(typeof row.cacheWrite5mTokens === "number" || row.cacheWrite5mTokens === null).toBe(true)
    expect(typeof row.cacheWrite1hTokens === "number" || row.cacheWrite1hTokens === null).toBe(true)
    expect(typeof row.cost).toBe("number")
    expect(row.enrichment === null || typeof row.enrichment === "object").toBe(true)
  })
})
