// opencode-cost/zen-sync.ts — pulls per-row Zen usage from the internal
// `_server` endpoint, parses the `$R[n]` slot-graph response with the
// `new Date("ISO")` literal extension, and writes typed rows to
// `zen_usage`. After each successful sync, `zen_daily_billed` is rebuilt
// from `zen_usage` via UPSERT GROUP BY (date, model, key_id).
//
// Design and rationale:
//   ../../../../docs/archive/opencode/PLAN-cost-pertask-tmux-status.md
//   (§4.1 zen_usage schema, §5 sync loop, §10.6 + §10.7 acceptance
//   tests, §13 archived parent at PLAN-cost-tracker.md).
//
// Phase ownership of this file:
//   Z0 (parser) — static $R[n] walker extended to recognize
//     `new Date("ISO")` literals and surface the ISO string as the row
//     field value. `parseUsageList(body): ZenUsageRowFull[]` is the
//     per-row entry point; unknown row fields collect under
//     `enrichment` per the §4.1 forward-compat decision pinned by
//     §10.7.f.
//   Z3 (sync loop) — 2-arg `_server` per-row body (workspaceId, page);
//     pagination loop with empty/short-page/newestKnown-overlap/1000-
//     page-cap stop conditions per §5.2; `acquireSyncLock` advisory
//     lock at ~/.local/state/opencode-cost/zen-sync.lock per §5.3
//     (exit code 75 on contention, OPENCODE_COST_LOCK_DIR env override
//     for test isolation).
//
// IMPORTANT: parse the response STATICALLY. Do NOT use `node:vm`, `eval`,
// or `new Function()` to evaluate the returned IIFE wrapper. The parser
// is a small recursive-descent over a JS-literal subset (objects, arrays,
// primitives, `$R[N]` reads/writes, `new Date("ISO")`, arrow function
// bodies, IIFE wrappers via parens + trailers). It rejects anything else,
// so a malicious/altered response can't smuggle behaviour past it.
//
// Request shape (per-row, captured 2026-05-19 from Zen's usage page):
//
//   POST https://opencode.ai/_server
//   Body: {"t":{"t":9,"i":0,"l":2,"a":[
//            {"t":1,"s":"<workspace_id>"},
//            {"t":0,"s":<page>},
//          ],"o":0},
//          "f":31,"m":[]}
//
// Response shape (after stripping `;0xNNNNN;` chunk prefixes and parsing
// the `$R[n]` slot graph):
//
//   $R[0] = Array<{
//     id, workspaceId, sessionId, keyId, model, provider,
//     timeCreated, timeUpdated, timeDeleted,
//     inputTokens, outputTokens, reasoningTokens,
//     cacheReadTokens, cacheWrite5mTokens, cacheWrite1hTokens,
//     cost,
//     ...any unrecognized fields land under `enrichment`
//   }>
//
// Fragility budget (full table in PLAN.md §8):
//   - Cookie expires       → 401 / login redirect → recapture from DevTools.
//   - x-server-id rotates  → 4xx/5xx → re-scrape from workspace HTML.
//   - f:31 function shifts → wrong-shape response → re-scrape JS bundle.
//   - $R[n] format changes → parse failure → dump raw response, bail loud.
//   - Page size constant (50) drifts → short-page guard handles both
//     directions (§10.6.i / §10.6.j).
//   - Concurrent sync runs (timer + manual) → flock advisory at
//     ~/.local/state/opencode-cost/zen-sync.lock → exit 75 on contention.

import fs from "node:fs"
import path from "node:path"
import { Database } from "bun:sqlite"
import { applySchema } from "../plugins/cost-tracker/db.ts"

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/**
 * Per-row Zen usage shape after normalization. Mirrors the §4.1
 * `zen_usage` schema column-for-column (camelCase here, snake_case in
 * SQLite). The `enrichment` map is the forward-compat sink for any
 * top-level row field not already in the typed schema; serialized to
 * `enrichment_json` on persist. Pinned by tests §10.7.f.
 */
export type ZenUsageRowFull = {
  id: string
  workspaceId: string
  sessionId: string | null
  keyId: string
  model: string
  provider: string
  timeCreated: string
  timeUpdated: string
  timeDeleted: string | null
  inputTokens: number
  outputTokens: number
  reasoningTokens: number | null
  cacheReadTokens: number
  cacheWrite5mTokens: number | null
  cacheWrite1hTokens: number | null
  cost: number
  enrichment: Record<string, unknown> | null
}

export type ZenSyncConfig = {
  workspaceId: string
  keyId: string
  /** @deprecated tz_offset is unused by the per-row endpoint; kept on the
   * type for backward compat with config.json files that still carry it. */
  tzOffset: string
  serverId: string
  fnIndex?: number
}

export type SyncAllResult = {
  written: number
  fetched: number
  pagesFetched: number
}

export type SyncLockHandle = {
  release: () => Promise<void>
  pid: number
  since: string
}

// --------------------------------------------------------------------------
// Config + cookie loaders
// --------------------------------------------------------------------------

const HOME = process.env.HOME ?? "/root"
const CONFIG_PATH = process.env.OPENCODE_COST_CONFIG ??
  `${HOME}/.config/opencode-cost/config.json`
const COOKIE_PATH = process.env.OPENCODE_ZEN_COOKIE ??
  `${HOME}/.config/opencode/secrets/zen-session-cookie`
const DB_PATH = process.env.OPENCODE_COST_DB ??
  `${HOME}/.local/state/opencode-cost.db`
const DEFAULT_LOCK_DIR = `${HOME}/.local/state/opencode-cost`

const loadConfig = (): ZenSyncConfig => {
  let raw: string
  try {
    raw = fs.readFileSync(CONFIG_PATH, "utf8")
  } catch (e: any) {
    throw new Error(
      `cannot read ${CONFIG_PATH}: ${e?.message ?? e}\n` +
      `create it per PLAN.md §8 "Re-scrape x-server-id" with keys:\n` +
      `  workspace_id, key_id, server_id (optional: tz_offset, fn_index)`,
    )
  }
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch (e: any) {
    throw new Error(`${CONFIG_PATH}: invalid JSON (${e?.message ?? e})`)
  }
  const required = ["workspace_id", "server_id"] as const
  for (const k of required) {
    if (typeof parsed[k] !== "string" || parsed[k].length === 0) {
      throw new Error(`${CONFIG_PATH}: missing or empty field "${k}"`)
    }
  }
  if (typeof parsed.tz_offset === "string" && parsed.tz_offset.length > 0) {
    // Per §14 open item 3: tz_offset is vestigial for the per-row endpoint.
    // Warn once per process so operators can clean it up at leisure.
    console.warn(
      "[zen-sync] tz_offset is deprecated and ignored by the per-row " +
      "endpoint; remove from ~/.config/opencode-cost/config.json.",
    )
  }
  return {
    workspaceId: parsed.workspace_id,
    keyId: parsed.key_id ?? "",
    tzOffset: parsed.tz_offset ?? "",
    serverId: parsed.server_id,
    fnIndex: typeof parsed.fn_index === "number" ? parsed.fn_index : undefined,
  }
}

const loadCookie = (): string => {
  let raw: string
  try {
    raw = fs.readFileSync(COOKIE_PATH, "utf8")
  } catch (e: any) {
    throw new Error(
      `cannot read ${COOKIE_PATH}: ${e?.message ?? e}\n` +
      `recapture per PLAN.md §8 "Re-capture Zen session cookie".`,
    )
  }
  const trimmed = raw.trim()
  if (trimmed.length === 0) throw new Error(`${COOKIE_PATH}: empty cookie`)
  return trimmed
}

// --------------------------------------------------------------------------
// Request builder (per-row, 2-arg)
// --------------------------------------------------------------------------

/**
 * Per-row `usage.list` body: TanStack-Start serializer with two function
 * args — workspace_id (string) and page (0-indexed int). Replaces the
 * Phase 4 four-arg daily-aggregate body. Pinned by the loop tests' mock
 * server, which decodes `body.t.a[1].s` as the page index.
 *
 * Note: unlike the legacy daily-aggregate endpoint (`f: 31`), the
 * per-row endpoint is dispatched by an SHA-256 X-Server-Id header
 * (createServerReference in Zen's frontend bundle), so this body
 * carries NO `f` field. fnIndex is retained on the signature for
 * call-site compatibility but currently ignored; pass any value.
 */
export const buildPerRowRequestBody = (
  workspaceId: string,
  page: number,
  _fnIndex?: number,
): string => {
  return JSON.stringify({
    t: {
      t: 9,
      i: 0,
      l: 2,
      a: [
        { t: 1, s: workspaceId },
        { t: 0, s: page },
      ],
      o: 0,
    },
    m: [],
  })
}

/**
 * SHA-256 reference for the per-row `usage.list` server function. Read
 * out of Zen's frontend bundle (`createServerReference("...")` in
 * `_build/assets/index-*.js`). When this rotates after a Zen deploy,
 * the diagnostic on HTTP 4xx/5xx in fetchPage points the operator at
 * the recovery runbook (PLAN §8). Override via OPENCODE_COST_USAGE_LIST_SHA.
 */
const DEFAULT_USAGE_LIST_SHA =
  "bfd684bfc2e4eed05cd0b518f5e4eafd3f3376e3938abb9e536e7c03df831e5c"

const resolveUsageListSha = (config: ZenSyncConfig): string =>
  process.env.OPENCODE_COST_USAGE_LIST_SHA ??
  (config as unknown as { usageListSha?: string }).usageListSha ??
  DEFAULT_USAGE_LIST_SHA

// --------------------------------------------------------------------------
// Chunk-prefix stripper
// --------------------------------------------------------------------------

// Zen's `_server` endpoint emits the response body with `;0xHEX;` chunk
// prefixes (custom framing, not standard HTTP chunked-transfer). Strip
// them out and concatenate. Multi-chunk responses appear in practice when
// the body crosses ~8KB.
//
// Example: ";0x1234;{...}\n;0x5678;{more}" → "{...}\n{more}"
export const stripChunkPrefixes = (body: string): string =>
  body.replace(/;0x[0-9a-fA-F]+;/g, "")

// --------------------------------------------------------------------------
// Static $R[n] graph parser
// --------------------------------------------------------------------------
//
// Grammar (recursive-descent):
//
//   program     := stmt (';' stmt)*
//   stmt        := value
//   value       := primary
//   primary     := assign | object | array | string | number | literal
//                | refRead | parens | arrow | call | member | comment
//                | newDate
//   newDate     := 'new' 'Date' '(' (string|number)? (',' value)* ')'
//   assign      := '$R[' int ']' '=' value
//   refRead     := '$R[' int ']'                       -- back-reference
//   object      := '{' (key ':' value (',' key ':' value)*)? '}'
//   key         := ident | string | number
//   array       := '[' (value (',' value)*)? ']'
//   string      := '"…"' | "'…'"
//   number      := /-?\d+(\.\d+)?(e[+-]?\d+)?/
//   literal     := 'null' | 'true' | 'false' | 'undefined' | 'NaN' | 'Infinity'
//   parens      := '(' value (',' value)* ')'          -- sequence; returns last
//   arrow       := ident '=>' arrowBody | '(' params ')' '=>' arrowBody
//   arrowBody   := value | '{' (stmt ';')* (stmt)? '}' -- block returns last
//   call        := value '(' (value (',' value)*)? ')' -- discard, return callee
//   member      := value '.' ident | value '[' (string|number) ']'
//
// The parser walks the response and accumulates `$R[N] = expr` bindings
// in a `slots` map as side-effects during expression evaluation. After
// parsing, we return slots[0] (the root of the seroval graph).

type Slots = Map<number, unknown>
type Ref = { __ref: number }
const makeRef = (id: number): Ref => ({ __ref: id })
const isRef = (v: unknown): v is Ref =>
  typeof v === "object" && v !== null && "__ref" in (v as Record<string, unknown>)

class ParseState {
  pos = 0
  constructor(public readonly src: string, public readonly slots: Slots = new Map()) {}
  peek(off = 0): string { return this.src[this.pos + off] ?? "" }
  rest(n = 30): string { return this.src.slice(this.pos, this.pos + n) }
  err(msg: string): Error {
    const ctx = this.src.slice(Math.max(0, this.pos - 20), this.pos + 30)
    return new Error(`parse error at ${this.pos}: ${msg}\n  near: …${ctx}…`)
  }
}

const isWs = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r"
const isDigit = (c: string) => c >= "0" && c <= "9"
const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c)
const isIdentCont = (c: string) => /[A-Za-z0-9_$]/.test(c)

const skipWs = (s: ParseState): void => {
  while (s.pos < s.src.length) {
    const c = s.peek()
    if (isWs(c)) { s.pos++; continue }
    // Line comment
    if (c === "/" && s.peek(1) === "/") {
      while (s.pos < s.src.length && s.peek() !== "\n") s.pos++
      continue
    }
    // Block comment
    if (c === "/" && s.peek(1) === "*") {
      s.pos += 2
      while (s.pos < s.src.length && !(s.peek() === "*" && s.peek(1) === "/")) s.pos++
      s.pos += 2
      continue
    }
    break
  }
}

const consume = (s: ParseState, str: string): boolean => {
  if (s.src.slice(s.pos, s.pos + str.length) === str) {
    s.pos += str.length
    return true
  }
  return false
}

const expect = (s: ParseState, ch: string): void => {
  skipWs(s)
  if (s.peek() !== ch) throw s.err(`expected '${ch}', got '${s.peek()}'`)
  s.pos++
}

const parseString = (s: ParseState): string => {
  const quote = s.peek()
  if (quote !== '"' && quote !== "'") throw s.err(`expected string`)
  s.pos++
  let out = ""
  while (s.pos < s.src.length && s.peek() !== quote) {
    if (s.peek() === "\\") {
      const next = s.peek(1)
      s.pos += 2
      switch (next) {
        case "n": out += "\n"; break
        case "t": out += "\t"; break
        case "r": out += "\r"; break
        case "b": out += "\b"; break
        case "f": out += "\f"; break
        case "\\": out += "\\"; break
        case "/": out += "/"; break
        case '"': out += '"'; break
        case "'": out += "'"; break
        case "`": out += "`"; break
        case "u": {
          const hex = s.src.slice(s.pos, s.pos + 4)
          s.pos += 4
          out += String.fromCharCode(parseInt(hex, 16))
          break
        }
        case "x": {
          const hex = s.src.slice(s.pos, s.pos + 2)
          s.pos += 2
          out += String.fromCharCode(parseInt(hex, 16))
          break
        }
        default: out += next
      }
    } else {
      out += s.peek()
      s.pos++
    }
  }
  if (s.peek() !== quote) throw s.err(`unterminated string`)
  s.pos++
  return out
}

const parseNumber = (s: ParseState): number => {
  const start = s.pos
  if (s.peek() === "-" || s.peek() === "+") s.pos++
  while (isDigit(s.peek())) s.pos++
  if (s.peek() === ".") {
    s.pos++
    while (isDigit(s.peek())) s.pos++
  }
  if (s.peek() === "e" || s.peek() === "E") {
    s.pos++
    if (s.peek() === "+" || s.peek() === "-") s.pos++
    while (isDigit(s.peek())) s.pos++
  }
  return parseFloat(s.src.slice(start, s.pos))
}

const parseIdent = (s: ParseState): string => {
  const start = s.pos
  if (!isIdentStart(s.peek())) throw s.err(`expected identifier`)
  while (isIdentCont(s.peek())) s.pos++
  return s.src.slice(start, s.pos)
}

// Forward decl
let parseValue: (s: ParseState) => unknown

const parseArgList = (s: ParseState): unknown[] => {
  expect(s, "(")
  const args: unknown[] = []
  skipWs(s)
  if (s.peek() === ")") { s.pos++; return args }
  for (;;) {
    skipWs(s)
    args.push(parseValue(s))
    skipWs(s)
    if (s.peek() === ",") { s.pos++; continue }
    break
  }
  expect(s, ")")
  return args
}

const parseArray = (s: ParseState): unknown[] => {
  expect(s, "[")
  const out: unknown[] = []
  skipWs(s)
  if (s.peek() === "]") { s.pos++; return out }
  for (;;) {
    skipWs(s)
    if (s.peek() === ",") { out.push(undefined); s.pos++; continue }  // sparse: [,1]
    if (s.peek() === "]") break
    out.push(parseValue(s))
    skipWs(s)
    if (s.peek() === ",") { s.pos++; continue }
    break
  }
  expect(s, "]")
  return out
}

const parseObject = (s: ParseState): Record<string, unknown> => {
  expect(s, "{")
  const out: Record<string, unknown> = {}
  skipWs(s)
  if (s.peek() === "}") { s.pos++; return out }
  for (;;) {
    skipWs(s)
    let key: string
    const c = s.peek()
    if (c === '"' || c === "'") key = parseString(s)
    else if (isDigit(c)) key = String(parseNumber(s))
    else if (isIdentStart(c)) key = parseIdent(s)
    else throw s.err(`expected object key`)
    skipWs(s)
    expect(s, ":")
    out[key] = parseValue(s)
    skipWs(s)
    if (s.peek() === ",") { s.pos++; continue }
    break
  }
  expect(s, "}")
  return out
}

// Parses `$R[N]` or `$R[N] = expr`. Returns expr (assignment expr value).
//
// Falls through to generic member-access semantics when the bracket
// contents are not a slot index — e.g. `$R["server-fn:0"]` in the IIFE
// invocation, which is a property lookup on the slot array's host object
// and has no role in graph extraction.
const parseRefOrAssign = (s: ParseState): unknown => {
  if (!consume(s, "$R[")) throw s.err(`expected $R[`)
  skipWs(s)
  if (!isDigit(s.peek())) {
    // Not `$R[N]`. Treat as `$R[<anything>]` member access: discard the
    // bracketed expression and return undefined. The surrounding
    // parseTrailers handles any following `(args)` / `.prop` chain.
    parseValue(s)
    skipWs(s)
    expect(s, "]")
    // Swallow optional assignment: `$R["server-fn:0"] = [...]` happens
    // in the wrapper. The value is discarded.
    skipWs(s)
    if (s.peek() === "=" && s.peek(1) !== "=" && s.peek(1) !== ">") {
      s.pos++
      parseValue(s)
    }
    return undefined
  }
  const start = s.pos
  while (isDigit(s.peek())) s.pos++
  const id = parseInt(s.src.slice(start, s.pos), 10)
  expect(s, "]")
  skipWs(s)
  // Distinguish `$R[N]=expr` (assignment) from `$R[N]==…` (comparison).
  // seroval doesn't emit comparisons but be safe.
  if (s.peek() === "=" && s.peek(1) !== "=" && s.peek(1) !== ">") {
    s.pos++
    const value = parseValue(s)
    s.slots.set(id, value)
    return value
  }
  // Read-only back-reference. Resolve eagerly if already in the slot map
  // (preserves instance equality across shared back-refs per §10.7.b);
  // otherwise emit a placeholder for the post-pass to resolve.
  if (s.slots.has(id)) return s.slots.get(id)
  return makeRef(id)
}

// Consumes `(expr, expr, ...)` and returns the LAST value (JS sequence
// operator). Also covers grouped expressions `(expr)`.
const parseParens = (s: ParseState): unknown => {
  expect(s, "(")
  let last: unknown = undefined
  skipWs(s)
  if (s.peek() === ")") { s.pos++; return undefined }
  for (;;) {
    skipWs(s)
    last = parseValue(s)
    skipWs(s)
    if (s.peek() === ",") { s.pos++; continue }
    break
  }
  expect(s, ")")
  return last
}

// Post-parse trailers: `.foo`, `["foo"]`, `(args...)`, `= expr`, and the
// `||` / `??` short-circuit operators. Most of these are no-ops for
// graph extraction (we only care about `$R[N] = expr`, handled in
// parseRefOrAssign). The rest are absorbed so the IIFE wrapper boilerplate
// parses without errors.
const parseTrailers = (s: ParseState, value: unknown): unknown => {
  for (;;) {
    skipWs(s)
    const c = s.peek()
    if (c === ".") {
      s.pos++
      // Member access: skip identifier (e.g. `self.$R`); we don't model it.
      skipWs(s)
      if (isIdentStart(s.peek())) parseIdent(s)
      continue
    }
    if (c === "[") {
      // Either `value[key]` member access (skip) or `value[N]` index (skip).
      // We've already special-cased `$R[N]` reads in parseRefOrAssign.
      s.pos++
      skipWs(s)
      parseValue(s)
      skipWs(s)
      expect(s, "]")
      continue
    }
    if (c === "(") {
      // Function call. Parse args, return callee. This is how IIFE
      // invocation reduces to the arrow function's body value.
      parseParens(s)
      continue
    }
    if (c === "=" && s.peek(1) !== "=" && s.peek(1) !== ">") {
      // Generic assignment `lhs = rhs`. The RHS becomes the expression's
      // value (JS assignment-expression semantics). We don't model the
      // LHS — `$R[N] = …` is special-cased in parseRefOrAssign.
      s.pos++
      value = parseValue(s)
      continue
    }
    if (c === "|" && s.peek(1) === "|") {
      // `a || b` short-circuit: in the IIFE wrapper this appears as
      // `self.$R || {}`. We don't model truthiness; just return `b`
      // (the empty object literal) so the surrounding chain reads as
      // the eventually-mutated slot host. Doesn't matter for graph
      // extraction either way — both sides are unmodeled.
      s.pos += 2
      value = parseValue(s)
      continue
    }
    if (c === "?" && s.peek(1) === "?") {
      // `a ?? b` nullish coalescing — same handling as `||`.
      s.pos += 2
      value = parseValue(s)
      continue
    }
    break
  }
  return value
}

// Parse an arrow function body. The expression form (`x => x + 1`) is
// just a value. The block form (`x => { stmt; stmt; return X }`) needs
// a separate parser because the existing object parser would mis-parse
// `{ $R[1] = ... }` as an object literal with key `$R`.
//
// Statements inside the block can include `return X` (we strip the
// keyword and parse X as the block's return value), bare assignments
// like `$R[N] = ...` (side-effect on the slot map; value discarded),
// or any other value. Multiple statements separated by `;`.
const parseBlockBody = (s: ParseState): unknown => {
  expect(s, "{")
  let last: unknown = undefined
  for (;;) {
    skipWs(s)
    if (s.peek() === "}" || s.pos >= s.src.length) break
    // Allow `return X` — discard the `return`, parse the expr.
    if (
      s.src.slice(s.pos, s.pos + 6) === "return" &&
      !isIdentCont(s.peek(6))
    ) {
      s.pos += 6
      skipWs(s)
      if (s.peek() === ";" || s.peek() === "}") {
        last = undefined
      } else {
        last = parseValue(s)
      }
    } else {
      last = parseValue(s)
    }
    skipWs(s)
    // Multiple `;` separators allowed.
    while (s.peek() === ";") { s.pos++; skipWs(s) }
  }
  if (s.peek() === "}") s.pos++
  return last
}

const parseArrowBody = (s: ParseState): unknown => {
  skipWs(s)
  if (s.peek() === "{") return parseBlockBody(s)
  return parseValue(s)
}

// Detect an arrow function: `ident =>` or `(ident, ident, ...) =>`. We
// drop the parameter list and parse the body. Inside the body, any
// $R[N] reads/writes hit the same slot map (the parameter rename is
// a JS detail we don't model — the response always names the
// parameter `$R`).
const tryParseArrow = (s: ParseState): unknown | typeof NO_MATCH => {
  // Single-ident arrow: `$R => …`
  if (isIdentStart(s.peek())) {
    const idStart = s.pos
    parseIdent(s)
    skipWs(s)
    if (s.src.slice(s.pos, s.pos + 2) === "=>") {
      s.pos += 2
      return parseArrowBody(s)
    }
    s.pos = idStart
  }
  // Parenthesized arrow: `($R) => …` or `() => …`. Look ahead for `=>`
  // after a matched `(...)`.
  if (s.peek() === "(") {
    const depth0 = s.pos
    let depth = 0
    let i = s.pos
    while (i < s.src.length) {
      const ch = s.src[i]
      if (ch === "(") depth++
      else if (ch === ")") { depth--; if (depth === 0) { i++; break } }
      else if (ch === '"' || ch === "'") {
        // Skip strings inside the param list (shouldn't happen, but safe).
        const q = ch
        i++
        while (i < s.src.length && s.src[i] !== q) {
          if (s.src[i] === "\\") i++
          i++
        }
        i++
        continue
      }
      i++
    }
    let j = i
    while (j < s.src.length && isWs(s.src[j])) j++
    if (s.src.slice(j, j + 2) === "=>") {
      s.pos = j + 2
      return parseArrowBody(s)
    }
    s.pos = depth0
  }
  return NO_MATCH
}
const NO_MATCH = Symbol("NO_MATCH")

parseValue = (s: ParseState): unknown => {
  skipWs(s)
  const c = s.peek()

  // Try arrow function before identifier-as-trailing-expression.
  if (c === "(" || isIdentStart(c)) {
    const arrow = tryParseArrow(s)
    if (arrow !== NO_MATCH) return arrow
  }

  // Unary `!`: seroval emits `!0` / `!1` for `true` / `false` (minified
  // boolean idiom). Generally `!<expr>` negates the JS truthiness of
  // <expr>. For graph extraction we only see literals here.
  if (c === "!") {
    s.pos++
    const inner = parseValue(s)
    return !inner
  }

  // Unary `void`: seroval emits `void 0` for `undefined`.
  if (c === "v" && s.src.slice(s.pos, s.pos + 5) === "void ") {
    s.pos += 5
    parseValue(s)  // discard
    return undefined
  }

  // Unary `-` / `+` on non-numeric atoms (`-Infinity`, `-(expr)`). The
  // numeric form (`-1.5`) is handled by parseNumber below.
  if ((c === "-" || c === "+") && !isDigit(s.peek(1)) && s.peek(1) !== ".") {
    const sign = c
    s.pos++
    const inner = parseValue(s)
    if (typeof inner === "number") return sign === "-" ? -inner : inner
    // Non-numeric unary on weird value: best-effort no-op.
    return inner
  }

  let val: unknown
  if (c === "{") val = parseObject(s)
  else if (c === "[") val = parseArray(s)
  else if (c === '"' || c === "'") val = parseString(s)
  else if (c === "(") val = parseParens(s)
  else if (c === "-" || c === "+" || isDigit(c) || c === ".") val = parseNumber(s)
  else if (c === "$" && s.peek(1) === "R" && s.peek(2) === "[") val = parseRefOrAssign(s)
  else if (isIdentStart(c)) {
    const ident = parseIdent(s)
    if (ident === "null") val = null
    else if (ident === "true") val = true
    else if (ident === "false") val = false
    else if (ident === "undefined") val = undefined
    else if (ident === "NaN") val = NaN
    else if (ident === "Infinity") val = Infinity
    else if (ident === "new") {
      // §10.7.a — `new Date("ISO")` literal. seroval emits Date instances
      // this way; surface the ISO string as the value so the per-row
      // normalizer can store it in `time_created` / `time_updated` /
      // `time_deleted` columns unchanged. Other constructors are
      // best-effort discarded (consume optional arg list, return undef).
      skipWs(s)
      const ctor = isIdentStart(s.peek()) ? parseIdent(s) : ""
      skipWs(s)
      if (ctor === "Date" && s.peek() === "(") {
        const args = parseArgList(s)
        if (args.length === 0) val = new Date(0).toISOString()
        else if (typeof args[0] === "string") val = args[0]
        else if (typeof args[0] === "number") val = new Date(args[0]).toISOString()
        else val = undefined
      } else {
        if (s.peek() === "(") parseArgList(s)
        val = undefined
      }
    }
    else if (ident === "self" || ident === "globalThis" || ident === "window") {
      // `self.$R = self.$R || {}` boilerplate — descend into trailers and
      // let them swallow the rest of the chain.
      val = undefined
    } else val = undefined  // unknown ident; assume identity / no-op
  } else {
    throw s.err(`unexpected character '${c}'`)
  }
  return parseTrailers(s, val)
}

// Replace { __ref: N } placeholders with the resolved slot value. The
// graph can contain cycles (seroval supports them); track visited refs
// to avoid infinite recursion. In practice Zen's `usage` payload doesn't
// cycle, but defending against it costs almost nothing.
const resolveRefs = (slots: Slots): void => {
  const visit = (v: unknown, seen: Set<unknown>): unknown => {
    if (v === null || typeof v !== "object") return v
    if (seen.has(v)) return v
    seen.add(v)
    if (isRef(v)) {
      const target = slots.get(v.__ref)
      if (target === undefined) return v  // unresolved; leave placeholder
      return visit(target, seen)
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) v[i] = visit(v[i], seen)
      return v
    }
    const obj = v as Record<string, unknown>
    for (const k of Object.keys(obj)) obj[k] = visit(obj[k], seen)
    return obj
  }
  for (const id of Array.from(slots.keys())) {
    const v = slots.get(id)
    slots.set(id, visit(v, new Set()))
  }
}

/**
 * Public low-level parser entry point. Strips chunk prefixes, parses the
 * full response, returns the root slot (`$R[0]`). Handles top-level
 * statement sequences (`stmt; stmt; stmt`) so IIFE-wrapped bodies parse
 * cleanly — see §10.7.i fixture.
 */
export const parseServerResponse = (body: string): unknown => {
  const stripped = stripChunkPrefixes(body).trim()
  if (stripped.length === 0) throw new Error("empty response body")
  const state = new ParseState(stripped)
  // Allow leading `;` separators (defensive against minifier quirks).
  skipWs(state)
  while (state.peek() === ";") { state.pos++; skipWs(state) }
  if (state.pos < state.src.length) parseValue(state)
  // Walk straggling statements after the first expression.
  for (;;) {
    skipWs(state)
    while (state.peek() === ";") { state.pos++; skipWs(state) }
    if (state.pos >= state.src.length) break
    const before = state.pos
    try { parseValue(state) } catch {
      // Bail on trailing garbage; we have the data we need.
      break
    }
    if (state.pos === before) break
  }
  resolveRefs(state.slots)
  const root = state.slots.get(0)
  if (root === undefined) {
    throw new Error("response did not assign $R[0]")
  }
  return root
}

// --------------------------------------------------------------------------
// Per-row normalizer
// --------------------------------------------------------------------------

// Field-name aliases. The plan's typed shape uses camelCase `workspaceId`,
// `keyId`, `sessionId` (which is what the test fixtures pin), but the
// real Zen `_server` response shapes them as `workspaceID`, `keyID`,
// `sessionID` (capital ID, SCREAMING_id style). Accept either spelling
// so the same normalizer handles fixtures AND live responses; canonical
// output uses the camelCase form. Recursive name clash: the real Zen
// row carries a top-level `enrichment: null` field that we want to
// fold INTO our own enrichment catch-all (so the column persists `null`
// rather than `{enrichment: null}`).
const FIELD_ALIASES: Record<string, ReadonlyArray<string>> = {
  workspaceId: ["workspaceId", "workspaceID"],
  sessionId: ["sessionId", "sessionID"],
  keyId: ["keyId", "keyID"],
}

const ALIASED_INPUT_NAMES: ReadonlySet<string> = new Set(
  Object.values(FIELD_ALIASES).flatMap((arr) => [...arr]),
)

// All input field names the normalizer recognizes (either the canonical
// camelCase or one of the aliases above). Anything outside this set lands
// in `enrichment` for forward-compat per §4.1 / §10.7.f.
const KNOWN_INPUT_FIELDS: ReadonlySet<string> = new Set([
  "id", "model", "provider",
  "timeCreated", "timeUpdated", "timeDeleted",
  "inputTokens", "outputTokens", "reasoningTokens",
  "cacheReadTokens", "cacheWrite5mTokens", "cacheWrite1hTokens",
  "cost",
  // Aliased fields:
  ...ALIASED_INPUT_NAMES,
  // Real Zen carries a top-level `enrichment` field too. Fold it
  // into our own enrichment object rather than nesting under itself.
  "enrichment",
])

const requireString = (v: unknown, ctx: string): string => {
  if (typeof v !== "string") {
    throw new Error(`${ctx}: expected string, got ${typeof v} (${JSON.stringify(v)})`)
  }
  return v
}

const nullableString = (v: unknown, ctx: string): string | null => {
  if (v === null || v === undefined) return null
  if (typeof v === "string") return v
  throw new Error(`${ctx}: expected string or null, got ${typeof v}`)
}

const requireNumber = (v: unknown, ctx: string): number => {
  if (typeof v !== "number") {
    throw new Error(`${ctx}: expected number, got ${typeof v} (${JSON.stringify(v)})`)
  }
  return v
}

const nullableNumber = (v: unknown, ctx: string): number | null => {
  if (v === null || v === undefined) return null
  if (typeof v === "number") return v
  throw new Error(`${ctx}: expected number or null, got ${typeof v}`)
}

/** Return the first present value among the listed aliases, or undefined. */
const pickAliased = (r: Record<string, unknown>, aliases: readonly string[]): unknown => {
  for (const name of aliases) {
    if (name in r) return r[name]
  }
  return undefined
}

const normalizeRow = (raw: unknown, idx: number): ZenUsageRowFull => {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`$R[0][${idx}] is not an object (got ${typeof raw})`)
  }
  const r = raw as Record<string, unknown>
  const ctx = (field: string) => `$R[0][${idx}].${field}`

  // Collect unrecognized fields under enrichment (preserves the actual
  // object reference for shared back-refs per §10.7.b). The real Zen
  // top-level `enrichment` field (currently always null) merges in too.
  const enrichmentMap: Record<string, unknown> = {}
  for (const k of Object.keys(r)) {
    if (!KNOWN_INPUT_FIELDS.has(k)) enrichmentMap[k] = r[k]
  }
  // Fold the upstream `enrichment` value if it's a non-null object.
  const upstreamEnrichment = r.enrichment
  if (upstreamEnrichment && typeof upstreamEnrichment === "object" && !Array.isArray(upstreamEnrichment)) {
    for (const [k, v] of Object.entries(upstreamEnrichment as Record<string, unknown>)) {
      // Don't clobber locally-discovered enrichment keys with upstream's.
      if (!(k in enrichmentMap)) enrichmentMap[k] = v
    }
  }
  const enrichment = Object.keys(enrichmentMap).length > 0 ? enrichmentMap : null

  return {
    id: requireString(r.id, ctx("id")),
    workspaceId: requireString(pickAliased(r, FIELD_ALIASES.workspaceId), ctx("workspaceId")),
    sessionId: nullableString(pickAliased(r, FIELD_ALIASES.sessionId), ctx("sessionId")),
    keyId: requireString(pickAliased(r, FIELD_ALIASES.keyId), ctx("keyId")),
    model: requireString(r.model, ctx("model")),
    provider: requireString(r.provider, ctx("provider")),
    timeCreated: requireString(r.timeCreated, ctx("timeCreated")),
    timeUpdated: requireString(r.timeUpdated, ctx("timeUpdated")),
    timeDeleted: nullableString(r.timeDeleted, ctx("timeDeleted")),
    inputTokens: requireNumber(r.inputTokens, ctx("inputTokens")),
    outputTokens: requireNumber(r.outputTokens, ctx("outputTokens")),
    reasoningTokens: nullableNumber(r.reasoningTokens, ctx("reasoningTokens")),
    cacheReadTokens: requireNumber(r.cacheReadTokens, ctx("cacheReadTokens")),
    cacheWrite5mTokens: nullableNumber(r.cacheWrite5mTokens, ctx("cacheWrite5mTokens")),
    cacheWrite1hTokens: nullableNumber(r.cacheWrite1hTokens, ctx("cacheWrite1hTokens")),
    cost: requireNumber(r.cost, ctx("cost")),
    enrichment,
  }
}

/**
 * Per-row entry point. Parses a `_server` response body and returns the
 * typed `ZenUsageRowFull[]` array. Throws when `$R[0]` is not assigned
 * (deploy-time shape break) or when a known field has an unexpected
 * type. Unknown row fields are preserved under `enrichment` per the
 * §4.1 forward-compat decision.
 *
 * Acceptance: §10.7.a–i — see ./tests/zen-sync.parser.test.ts.
 */
export const parseUsageList = (body: string): ZenUsageRowFull[] => {
  const root = parseServerResponse(body)
  if (!Array.isArray(root)) {
    throw new Error(`expected $R[0] to be an array, got ${typeof root}`)
  }
  return root.map((raw, i) => normalizeRow(raw, i))
}

// --------------------------------------------------------------------------
// HTTP fetch (per-row, paginated)
// --------------------------------------------------------------------------

const fetchPage = async (
  page: number,
  cookie: string,
  config: ZenSyncConfig,
): Promise<ZenUsageRowFull[]> => {
  const body = buildPerRowRequestBody(config.workspaceId, page)
  const url = `https://opencode.ai/_server`
  const referer = `https://opencode.ai/workspace/${config.workspaceId}/usage`
  const usageListSha = resolveUsageListSha(config)

  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cookie": cookie,
        "origin": "https://opencode.ai",
        "referer": referer,
        "x-server-id": usageListSha,
        "x-server-instance": "server-fn:0",
      },
      body,
    })
  } catch (e: any) {
    throw new Error(`HTTP request to ${url} failed (page=${page}): ${e?.message ?? e}`)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `HTTP ${res.status} from Zen (page=${page}): cookie likely expired.\n` +
        `Recapture per PLAN.md §8 "Re-capture Zen session cookie".\n` +
        `Body excerpt: ${text.slice(0, 200)}`,
      )
    }
    if (res.status === 404 || res.status === 500) {
      throw new Error(
        `HTTP ${res.status} from Zen (page=${page}): x-server-id (${usageListSha}) ` +
        `may have rotated after a deploy.\n` +
        `Re-scrape from \`_build/assets/index-*.js\` (look for ` +
        `\`createServerReference("…")\` near \`usage.list\`).\n` +
        `Body excerpt: ${text.slice(0, 200)}`,
      )
    }
    throw new Error(`HTTP ${res.status} from Zen (page=${page}): ${text.slice(0, 500)}`)
  }

  const text = await res.text()
  try {
    return parseUsageList(text)
  } catch (e: any) {
    // Dump raw body for post-mortem.
    const dumpPath = path.join(
      process.env.XDG_STATE_HOME ?? `${HOME}/.local/state`,
      "opencode-cost",
    )
    let dumpFile = ""
    try {
      fs.mkdirSync(dumpPath, { recursive: true })
      dumpFile = path.join(dumpPath, `last-error-${Date.now()}.txt`)
      fs.writeFileSync(dumpFile, text, { encoding: "utf8", mode: 0o600 })
    } catch {
      // Best-effort; if we can't write the dump, just include the head.
    }
    const dumpNote = dumpFile ? `\n  raw body dumped to: ${dumpFile}` : ""
    throw new Error(
      `failed to parse Zen response (page=${page}): ${e?.message ?? e}${dumpNote}\n` +
      `body head: ${text.slice(0, 200)}`,
    )
  }
}

// --------------------------------------------------------------------------
// DB persistence
// --------------------------------------------------------------------------

const upsertZenUsage = (
  db: Database,
  rows: ZenUsageRowFull[],
  fetchedAt: string,
): void => {
  if (rows.length === 0) return
  const stmt = db.query(`
    INSERT OR REPLACE INTO zen_usage (
      id, workspace_id, session_id, key_id, model, provider,
      time_created, time_updated, time_deleted,
      input_tokens, output_tokens, reasoning_tokens,
      cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens,
      cost_fxp8, enrichment_json, fetched_at, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const tx = (db as any).transaction(() => {
    for (const r of rows) {
      let rawJson: string | null = null
      try {
        // Round-trip the typed row (excluding enrichment) so a future
        // schema evolution can replay. Failure to serialize is non-fatal.
        const snapshot = { ...r, enrichment: undefined as undefined }
        rawJson = JSON.stringify(snapshot)
      } catch {
        rawJson = null
      }
      const enrichmentJson = r.enrichment === null
        ? null
        : (() => {
            try { return JSON.stringify(r.enrichment) } catch { return null }
          })()
      stmt.run(
        r.id,
        r.workspaceId,
        r.sessionId,
        r.keyId,
        r.model,
        r.provider,
        r.timeCreated,
        r.timeUpdated,
        r.timeDeleted,
        r.inputTokens,
        r.outputTokens,
        r.reasoningTokens,
        r.cacheReadTokens,
        r.cacheWrite5mTokens,
        r.cacheWrite1hTokens,
        Math.round(r.cost),
        enrichmentJson,
        fetchedAt,
        rawJson,
      )
    }
  })
  tx()
}

/**
 * Rebuild `zen_daily_billed` from `zen_usage`. Per §4.2, after each sync
 * the daily rollup is derived via UPSERT GROUP BY (date, model, key_id)
 * so the existing dump-reconciliation surface keeps working unchanged.
 */
const deriveZenDailyBilled = (db: Database): void => {
  const tx = (db as any).transaction(() => {
    db.exec(`
      INSERT OR REPLACE INTO zen_daily_billed
        (date, model, key_id, plan, total_cost_fxp8, fetched_at)
      SELECT
        substr(time_created, 1, 10) AS date,
        model,
        key_id,
        NULL                         AS plan,
        SUM(cost_fxp8)               AS total_cost_fxp8,
        MAX(fetched_at)              AS fetched_at
      FROM zen_usage
      GROUP BY 1, 2, 3;
    `)
  })
  tx()
}

// --------------------------------------------------------------------------
// Sync loop
// --------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 50
const DEFAULT_MAX_PAGES = 1000

/**
 * Paginated sync against the per-row `_server` endpoint.
 *
 * Stop conditions (per §5.2):
 *   1. Empty page → end of stream.
 *   2. Short page (< 50 rows) → last page.
 *   3. Incremental: every row's timeCreated ≤ newestKnown → overlap reached.
 *   4. Safety cap at maxPages (default 1000) → throw when the source
 *      still appears to have more data. User-specified `maxPages`
 *      values (via the CLI's `--max-pages N` flag) are treated as a
 *      soft cap: the loop exits silently when reached. Only the
 *      default 1000 runaway-protection cap throws.
 *
 * Returns counts so callers can log them; logs are written from runZenSync.
 * Acceptance: §10.6.a–l — see ./tests/zen-sync.loop.test.ts.
 */
export const syncAll = async (opts: {
  cookie: string
  config: ZenSyncConfig
  db: Database
  mode: "incremental" | "full"
  /** When set, treated as a soft user-override; the loop exits silently
   *  when this cap is reached. Omit to use DEFAULT_MAX_PAGES with the
   *  runaway-throw semantics required by §10.6.h. */
  maxPages?: number
}): Promise<SyncAllResult> => {
  const userOverride = opts.maxPages !== undefined
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES
  const newestKnown = opts.mode === "incremental"
    ? (() => {
        const row = opts.db
          .query(
            "SELECT MAX(time_created) AS t FROM zen_usage WHERE workspace_id = ?",
          )
          .get(opts.config.workspaceId) as { t: string | null } | undefined
        return row?.t ?? null
      })()
    : null

  const beforeRow = opts.db
    .query("SELECT COUNT(*) AS n FROM zen_usage")
    .get() as { n: number }
  const fetchedAt = new Date().toISOString()

  let fetched = 0
  let pagesFetched = 0

  for (let page = 0; page < maxPages; page++) {
    const rows = await fetchPage(page, opts.cookie, opts.config)
    pagesFetched++

    if (rows.length === 0) {
      // §10.6.a empty page — clean exit, no upsert.
      break
    }

    upsertZenUsage(opts.db, rows, fetchedAt)
    fetched += rows.length

    // §10.6.b/d/i short page — stop after upsert.
    if (rows.length < DEFAULT_PAGE_SIZE) break

    // §10.6.e incremental overlap stop — only when newestKnown is set.
    if (
      opts.mode === "incremental" &&
      newestKnown !== null &&
      rows.every((r) => r.timeCreated <= newestKnown)
    ) {
      break
    }

    // §10.6.h safety cap — break out if next iteration would exceed.
    if (page + 1 >= maxPages) {
      if (userOverride) {
        // User-specified soft cap; respect their explicit bound silently.
        break
      }
      throw new Error(
        `zen-sync: exceeded ${maxPages}-page safety cap ` +
        `(workspace=${opts.config.workspaceId}); refusing to continue. ` +
        `Re-run with --max-pages to override.`,
      )
    }
  }

  const afterRow = opts.db
    .query("SELECT COUNT(*) AS n FROM zen_usage")
    .get() as { n: number }
  const written = afterRow.n - beforeRow.n
  return { written, fetched, pagesFetched }
}

// --------------------------------------------------------------------------
// Sync lock (advisory)
// --------------------------------------------------------------------------
//
// §5.3 — exclusive lock at <lockDir>/zen-sync.lock. Prevents the systemd
// timer + a manual run racing. Returns null on contention. The contract
// pinned by §10.6.k is:
//
//   1. Same-process double-acquire returns null on the second call.
//   2. Release allows re-acquisition.
//   3. Cross-process contention is detected via the PID written into
//      the lock file (stale-safe via process.kill(pid, 0) check).
//
// Strictly speaking, `flock(2)` is preferable for cross-process safety
// (kernel releases on process death). Bun doesn't expose flock natively
// without FFI; the PID-check approach below is equivalent for our
// workloads (the systemd timer + manual runs are the only contenders).

const heldLocks = new Set<string>()

export const acquireSyncLock = async (
  lockDir?: string,
): Promise<SyncLockHandle | null> => {
  const dir = lockDir ?? process.env.OPENCODE_COST_LOCK_DIR ?? DEFAULT_LOCK_DIR
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    // mkdir best-effort; if it fails because the path already exists or
    // permissions are odd we still try the open below.
  }
  const lockPath = path.join(dir, "zen-sync.lock")

  // Same-process check (in-memory registry).
  if (heldLocks.has(lockPath)) return null

  // Try exclusive create; if the file already exists, see whether the
  // holder is alive.
  let fd: number | null = null
  try {
    fd = fs.openSync(
      lockPath,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR,
      0o600,
    )
  } catch (e: any) {
    if (e?.code !== "EEXIST") return null
    // File exists — check holder PID.
    let holderPid = 0
    let holderSince = ""
    try {
      const content = fs.readFileSync(lockPath, "utf8")
      const lines = content.split("\n")
      holderPid = parseInt(lines[0] ?? "0", 10)
      holderSince = (lines[1] ?? "").trim()
    } catch {
      // Unreadable lock file — treat as contended (someone is mid-write).
      return null
    }
    if (holderPid > 0) {
      try {
        process.kill(holderPid, 0)
        // Holder still alive — contended.
        console.error(
          `[zen-sync] lock held by pid ${holderPid} since ${holderSince || "?"}`,
        )
        return null
      } catch (err: any) {
        if (err?.code !== "ESRCH") return null
        // Stale lock — take over by truncating.
        try {
          fd = fs.openSync(lockPath, fs.constants.O_RDWR | fs.constants.O_TRUNC, 0o600)
        } catch {
          return null
        }
      }
    } else {
      return null
    }
  }

  const since = new Date().toISOString()
  const pid = process.pid
  try {
    fs.writeSync(fd!, `${pid}\n${since}\n`)
    fs.fsyncSync(fd!)
  } catch {
    // Best-effort write; the open succeeded so we still hold the lock.
  }

  heldLocks.add(lockPath)

  return {
    pid,
    since,
    release: async () => {
      try {
        if (fd !== null) fs.closeSync(fd)
      } catch {}
      try {
        fs.unlinkSync(lockPath)
      } catch {
        // Already removed (e.g. tmp dir rmSync'd by test teardown).
      }
      heldLocks.delete(lockPath)
    },
  }
}

// --------------------------------------------------------------------------
// CLI entry
// --------------------------------------------------------------------------

export type ZenSyncArgs = {
  full?: boolean
  dryRun?: boolean
  maxPages?: number
}

const parseZenSyncArgs = (argv: string[]): ZenSyncArgs | { error: string } => {
  const out: ZenSyncArgs = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--full") {
      out.full = true
    } else if (a === "--dry-run") {
      out.dryRun = true
    } else if (a === "--max-pages") {
      const v = argv[++i]
      if (v === undefined) return { error: "--max-pages requires a positive integer" }
      const n = parseInt(v, 10)
      if (!Number.isFinite(n) || n <= 0) {
        return { error: `--max-pages must be a positive integer (got "${v}")` }
      }
      out.maxPages = n
    } else if (a.startsWith("--max-pages=")) {
      const v = a.slice("--max-pages=".length)
      const n = parseInt(v, 10)
      if (!Number.isFinite(n) || n <= 0) {
        return { error: `--max-pages must be a positive integer (got "${v}")` }
      }
      out.maxPages = n
    } else {
      return { error: `unknown argument: ${a}` }
    }
  }
  return out
}

export const runZenSync = async (argv: string[]): Promise<number> => {
  const parsed = parseZenSyncArgs(argv)
  if ("error" in parsed) {
    console.error(`opencode-cost zen-sync: ${parsed.error}`)
    return 2
  }

  // §5.3 — acquire the advisory lock first. If contended, exit 75
  // (Linux EX_TEMPFAIL convention; signals "retry later" to the
  // systemd timer without flagging as a hard failure).
  const lock = await acquireSyncLock()
  if (lock === null) {
    console.error(
      `opencode-cost zen-sync: another sync is already running ` +
      `(or stale lock held by a dead PID). Exit code 75; ` +
      `re-run after the holder finishes, or delete the lock file ` +
      `manually if you're sure it's stale.`,
    )
    return 75
  }

  try {
    let config: ZenSyncConfig
    let cookie: string
    try {
      config = loadConfig()
      cookie = loadCookie()
    } catch (e: any) {
      console.error(`opencode-cost zen-sync: ${e?.message ?? e}`)
      return 1
    }

    const mode: "incremental" | "full" = parsed.full ? "full" : "incremental"
    console.error(
      `opencode-cost zen-sync: ${mode} sync (workspace=${config.workspaceId}` +
      (parsed.maxPages ? `, max-pages=${parsed.maxPages}` : "") +
      (parsed.dryRun ? `, dry-run` : "") +
      `)…`,
    )

    // Open and bootstrap the schema in both dry-run and commit paths.
    // The plugin may not have been reloaded since the DB file last
    // changed; without applySchema, `zen_usage` wouldn't exist on
    // DBs older than P4.1 and the first read or write would crash.
    // Idempotent — CREATE TABLE IF NOT EXISTS plus the duplicate-column
    // catch in MIGRATIONS.
    let db: Database
    try {
      db = new Database(DB_PATH, { readwrite: true })
    } catch (e: any) {
      console.error(
        `opencode-cost zen-sync: cannot open ${DB_PATH} (${e?.message ?? e}).\n` +
        `Run an opencode session first to create the DB.`,
      )
      return 1
    }
    try {
      applySchema(db)
    } catch (e: any) {
      console.error(`opencode-cost zen-sync: schema apply failed (${e?.message ?? e})`)
      db.close()
      return 1
    }

    if (parsed.dryRun) {
      try {
        const newestKnown =
          (db
            .query("SELECT MAX(time_created) AS t FROM zen_usage WHERE workspace_id = ?")
            .get(config.workspaceId) as { t: string | null } | undefined)?.t ?? null

        let pages = 0
        let fetched = 0
        const seenIds = new Set<string>()
        for (let page = 0; page < (parsed.maxPages ?? DEFAULT_MAX_PAGES); page++) {
          const rows = await fetchPage(page, cookie, config)
          pages++
          if (rows.length === 0) break
          for (const r of rows) seenIds.add(r.id)
          fetched += rows.length
          if (rows.length < DEFAULT_PAGE_SIZE) break
          if (
            mode === "incremental" &&
            newestKnown !== null &&
            rows.every((r) => r.timeCreated <= newestKnown)
          ) break
        }
        console.error(
          `opencode-cost zen-sync (dry-run): ${pages} pages, ` +
          `${fetched} rows fetched, ${seenIds.size} unique ids. ` +
          `newestKnown=${newestKnown ?? "<none>"}. No writes.`,
        )
        return 0
      } catch (e: any) {
        console.error(`opencode-cost zen-sync (dry-run): ${e?.message ?? e}`)
        return 1
      } finally {
        db.close()
      }
    }

    try {
      const result = await syncAll({ cookie, config, db, mode, maxPages: parsed.maxPages })
      deriveZenDailyBilled(db)
      console.error(
        `opencode-cost zen-sync: ` +
        `wrote ${result.written} new row(s) to zen_usage; ` +
        `fetched ${result.fetched} across ${result.pagesFetched} page(s); ` +
        `zen_daily_billed rebuilt.`,
      )
      return 0
    } catch (e: any) {
      console.error(`opencode-cost zen-sync: ${e?.message ?? e}`)
      return 1
    } finally {
      db.close()
    }
  } finally {
    await lock.release()
  }
}
