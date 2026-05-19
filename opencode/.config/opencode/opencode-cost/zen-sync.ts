// opencode-cost/zen-sync.ts — pulls daily per-model billed-dollar totals
// from Zen's internal `_server` server-function endpoint, parses the
// `$R[n]` slot-graph response, and writes to `zen_daily_billed`.
//
// Design and rationale: ../../../../docs/plans/opencode-cost-tracker/PLAN.md
//
// Phase ownership of this file:
//   Phase 4 (zen reconciliation, tier: sota) — implements the request
//     builder, the `;0xHEX;` chunk-prefix stripper, the static `$R[n]`
//     graph parser, and the UPSERT into zen_daily_billed.
//
// IMPORTANT: parse the response STATICALLY. Do NOT use `node:vm`, `eval`,
// or `new Function()` to evaluate the returned IIFE. The static parser
// here is a small recursive-descent over a JS-literal subset (objects,
// arrays, primitives, `$R[N]` reads, `$R[N] = expr` assignments). It
// rejects anything else — so a malicious/altered response can't smuggle
// behaviour past it.
//
// Request shape (captured 2026-05-18 from Zen dashboard's workspace
// usage page — see PLAN.md §6 Phase 4 for full headers and decoding):
//
//   POST https://opencode.ai/_server
//   Body: {"t":{"t":9,"i":0,"l":4,"a":[
//            {"t":1,"s":"<workspace_id>"},
//            {"t":0,"s":<year>},
//            {"t":0,"s":<month_0_indexed>},
//            {"t":1,"s":"<tz_offset_like_-04:00>"}
//          ],"o":0},
//          "f":31,"m":[]}
//
// Response shape (after stripping `;0xNNNNN;` chunk prefixes and parsing
// the `$R[n]` slot graph):
//
//   { usage: Array<{ date, model, totalCost (fxp8), keyId, plan }>,
//     keys:  Array<{ id, displayName, deleted }> }
//
// Fragility budget (full table in PLAN.md §7):
//   - Cookie expires       → 401 / login redirect → recapture from DevTools.
//   - x-server-id rotates  → 4xx/5xx → re-scrape from workspace HTML.
//   - f:31 function shifts → wrong-shape response → re-scrape JS bundle.
//   - $R[n] format changes → parse failure → dump raw response, bail loud.

import fs from "node:fs"
import path from "node:path"
import { Database } from "bun:sqlite"

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export type ZenUsageRow = {
  date: string                // "YYYY-MM-DD"
  model: string               // e.g. "claude-opus-4-7"
  totalCost: number           // fxp8 USD (×1e-8). Integer per Zen's serializer.
  keyId: string
  plan: string | null         // null = pay-as-you-go
}

export type ZenKey = {
  id: string
  displayName: string
  deleted: boolean
}

export type ZenUsageResponse = {
  usage: ZenUsageRow[]
  keys: ZenKey[]
}

export type ZenSyncConfig = {
  workspaceId: string
  keyId: string               // optional; used as a default fallback only
  tzOffset: string            // e.g. "-04:00"
  serverId: string            // x-server-id; rotates on Zen deploys
  fnIndex?: number            // server-function index; defaults to 31 ("f":31)
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

const loadConfig = (): ZenSyncConfig => {
  let raw: string
  try {
    raw = fs.readFileSync(CONFIG_PATH, "utf8")
  } catch (e: any) {
    throw new Error(
      `cannot read ${CONFIG_PATH}: ${e?.message ?? e}\n` +
      `create it per PLAN.md §8 "Re-scrape x-server-id" with keys:\n` +
      `  workspace_id, key_id, tz_offset, server_id (optional: fn_index)`,
    )
  }
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch (e: any) {
    throw new Error(`${CONFIG_PATH}: invalid JSON (${e?.message ?? e})`)
  }
  const required = ["workspace_id", "tz_offset", "server_id"] as const
  for (const k of required) {
    if (typeof parsed[k] !== "string" || parsed[k].length === 0) {
      throw new Error(`${CONFIG_PATH}: missing or empty field "${k}"`)
    }
  }
  return {
    workspaceId: parsed.workspace_id,
    keyId: parsed.key_id ?? "",
    tzOffset: parsed.tz_offset,
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
// Request builder
// --------------------------------------------------------------------------

const buildRequestBody = (
  workspaceId: string,
  year: number,
  month0: number,        // 0-indexed
  tzOffset: string,
  fnIndex: number,
): string => {
  // See PLAN.md §6 Phase 4 for the TanStack-Start serializer encoding.
  return JSON.stringify({
    t: {
      t: 9,
      i: 0,
      l: 4,
      a: [
        { t: 1, s: workspaceId },
        { t: 0, s: year },
        { t: 0, s: month0 },
        { t: 1, s: tzOffset },
      ],
      o: 0,
    },
    f: fnIndex,
    m: [],
  })
}

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
// Grammar (recursive-descent, no operator precedence beyond what we need):
//
//   program     := value
//   value       := primary
//   primary     := assign | object | array | string | number | literal
//                | refRead | parens | arrow | call | member | comment
//   assign      := '$R[' int ']' '=' value
//   refRead     := '$R[' int ']'                       -- back-reference
//   object      := '{' (key ':' value (',' key ':' value)*)? '}'
//   key         := ident | string | number
//   array       := '[' (value (',' value)*)? ']'
//   string      := '"…"' | "'…'"
//   number      := /-?\d+(\.\d+)?(e[+-]?\d+)?/
//   literal     := 'null' | 'true' | 'false' | 'undefined'
//   parens      := '(' value (',' value)* ')'          -- sequence; returns last
//   arrow       := ident '=>' value                    -- discard params, parse body
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
  // Read-only back-reference. Resolve eagerly if already in the slot map;
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

// Detect an arrow function: `ident =>` or `(ident, ident, ...) =>`. We
// drop the parameter list and parse the body. Inside the body, any
// $R[N] reads/writes hit the same slot map (the parameter rename is
// a JS detail we don't model — the response always names the
// parameter `$R`).
const tryParseArrow = (s: ParseState): unknown | typeof NO_MATCH => {
  const save = s.pos
  // Single-ident arrow: `$R => …`
  if (isIdentStart(s.peek())) {
    const idStart = s.pos
    parseIdent(s)
    skipWs(s)
    if (s.src.slice(s.pos, s.pos + 2) === "=>") {
      s.pos += 2
      return parseValue(s)
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
      return parseValue(s)
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
  if (c === "v" && s.src.slice(s.pos, s.pos + 5) === "void " ) {
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

// Public parser entry point. Strips chunk prefixes, parses the full
// response, returns the root slot (`$R[0]`).
export const parseServerResponse = (body: string): unknown => {
  const stripped = stripChunkPrefixes(body).trim()
  if (stripped.length === 0) throw new Error("empty response body")
  const state = new ParseState(stripped)
  parseValue(state)
  // After parsing, also walk any straggling assignments after the IIFE
  // — defensive against future format changes.
  skipWs(state)
  while (state.pos < state.src.length) {
    const before = state.pos
    try { parseValue(state) } catch {
      // Bail on trailing garbage; we have the data we need.
      break
    }
    skipWs(state)
    if (state.pos === before) break
  }
  resolveRefs(state.slots)
  const root = state.slots.get(0)
  if (root === undefined) {
    throw new Error("response did not assign $R[0]")
  }
  return root
}

// Normalize the parsed response into ZenUsageResponse. Defensive against
// shape drift: missing fields default to null/0, type mismatches throw
// loudly (better than a silent skew in the reconciliation).
export const normalizeUsageResponse = (root: unknown): ZenUsageResponse => {
  if (typeof root !== "object" || root === null) {
    throw new Error(`expected object at $R[0], got ${typeof root}`)
  }
  const obj = root as Record<string, unknown>
  const usageRaw = obj.usage
  if (!Array.isArray(usageRaw)) {
    throw new Error(`expected $R[0].usage to be an array, got ${typeof usageRaw}`)
  }
  const usage: ZenUsageRow[] = usageRaw.map((row, i) => {
    if (typeof row !== "object" || row === null) {
      throw new Error(`$R[0].usage[${i}] is not an object`)
    }
    const r = row as Record<string, unknown>
    const date = String(r.date ?? "")
    const model = String(r.model ?? "")
    const keyId = String(r.keyId ?? "")
    const totalCostRaw = r.totalCost
    const totalCost = typeof totalCostRaw === "number"
      ? totalCostRaw
      : typeof totalCostRaw === "string" && /^-?\d+$/.test(totalCostRaw)
        ? parseInt(totalCostRaw, 10)
        : NaN
    if (!Number.isFinite(totalCost)) {
      throw new Error(`$R[0].usage[${i}].totalCost is not numeric: ${totalCostRaw}`)
    }
    const plan = r.plan == null ? null : String(r.plan)
    return { date, model, totalCost, keyId, plan }
  })
  const keysRaw = obj.keys
  const keys: ZenKey[] = Array.isArray(keysRaw)
    ? keysRaw.map(k => {
        const o = (k as Record<string, unknown>) ?? {}
        return {
          id: String(o.id ?? ""),
          displayName: String(o.displayName ?? ""),
          deleted: Boolean(o.deleted),
        }
      })
    : []
  return { usage, keys }
}

// --------------------------------------------------------------------------
// HTTP
// --------------------------------------------------------------------------

export const fetchZenUsage = async (
  config: ZenSyncConfig,
  cookie: string,
  year: number,
  month0: number,
): Promise<ZenUsageResponse> => {
  const fnIndex = config.fnIndex ?? 31
  const body = buildRequestBody(config.workspaceId, year, month0, config.tzOffset, fnIndex)
  const url = `https://opencode.ai/_server`
  const referer = `https://opencode.ai/workspace/${config.workspaceId}/usage`

  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cookie": cookie,
        "origin": "https://opencode.ai",
        "referer": referer,
        "x-server-id": config.serverId,
        "x-server-instance": "server-fn:0",
      },
      body,
    })
  } catch (e: any) {
    throw new Error(`HTTP request to ${url} failed: ${e?.message ?? e}`)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `HTTP ${res.status} from Zen: cookie likely expired.\n` +
        `Recapture per PLAN.md §8 "Re-capture Zen session cookie".\n` +
        `Body excerpt: ${text.slice(0, 200)}`,
      )
    }
    if (res.status === 404 || res.status === 500) {
      throw new Error(
        `HTTP ${res.status} from Zen: x-server-id (${config.serverId}) ` +
        `may have rotated after a deploy.\n` +
        `Re-scrape per PLAN.md §8 "Re-scrape x-server-id".\n` +
        `Body excerpt: ${text.slice(0, 200)}`,
      )
    }
    throw new Error(`HTTP ${res.status} from Zen: ${text.slice(0, 500)}`)
  }

  const text = await res.text()
  try {
    const root = parseServerResponse(text)
    return normalizeUsageResponse(root)
  } catch (e: any) {
    // Dump raw body for post-mortem — schema drift is the highest-impact
    // failure mode and the dump is the only way to diagnose it.
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
      `failed to parse Zen response: ${e?.message ?? e}${dumpNote}\n` +
      `body head: ${text.slice(0, 200)}`,
    )
  }
}

// --------------------------------------------------------------------------
// DB persistence
// --------------------------------------------------------------------------

const upsertRows = (db: Database, rows: ZenUsageRow[]): { written: number } => {
  const fetchedAt = new Date().toISOString()
  const stmt = db.query(`
    INSERT OR REPLACE INTO zen_daily_billed
      (date, model, key_id, plan, total_cost_fxp8, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  let written = 0
  // Wrap in a transaction for atomicity. Bun:sqlite's `transaction()`
  // returns a callable that re-runs the body inside BEGIN/COMMIT.
  const tx = (db as any).transaction(() => {
    for (const r of rows) {
      stmt.run(r.date, r.model, r.keyId, r.plan, Math.round(r.totalCost), fetchedAt)
      written++
    }
  })
  tx()
  return { written }
}

// --------------------------------------------------------------------------
// CLI entry
// --------------------------------------------------------------------------

export type ZenSyncArgs = {
  month?: string                 // "YYYY-MM"; defaults to current month
  dryRun?: boolean
}

const parseZenSyncArgs = (argv: string[]): ZenSyncArgs | { error: string } => {
  const out: ZenSyncArgs = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--month") {
      const v = argv[++i]
      if (v === undefined) return { error: "--month requires YYYY-MM" }
      out.month = v
    } else if (a.startsWith("--month=")) {
      out.month = a.slice("--month=".length)
    } else if (a === "--dry-run") {
      out.dryRun = true
    } else {
      return { error: `unknown argument: ${a}` }
    }
  }
  if (out.month !== undefined && !/^\d{4}-\d{2}$/.test(out.month)) {
    return { error: `--month must be YYYY-MM (got "${out.month}")` }
  }
  return out
}

const currentMonth = (): { year: number; month0: number; key: string } => {
  const d = new Date()
  return {
    year: d.getFullYear(),
    month0: d.getMonth(),
    key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
  }
}

export const runZenSync = async (argv: string[]): Promise<number> => {
  const parsed = parseZenSyncArgs(argv)
  if ("error" in parsed) {
    console.error(`opencode-cost: ${parsed.error}`)
    return 2
  }

  let config: ZenSyncConfig
  let cookie: string
  try {
    config = loadConfig()
    cookie = loadCookie()
  } catch (e: any) {
    console.error(`opencode-cost zen-sync: ${e?.message ?? e}`)
    return 1
  }

  let year: number, month0: number, key: string
  if (parsed.month !== undefined) {
    const [y, m] = parsed.month.split("-").map(n => parseInt(n, 10))
    year = y
    month0 = m - 1
    key = parsed.month
  } else {
    const now = currentMonth()
    year = now.year
    month0 = now.month0
    key = now.key
  }

  console.error(`opencode-cost zen-sync: fetching ${key} (workspace=${config.workspaceId})…`)
  let resp: ZenUsageResponse
  try {
    resp = await fetchZenUsage(config, cookie, year, month0)
  } catch (e: any) {
    console.error(`opencode-cost zen-sync: ${e?.message ?? e}`)
    return 1
  }

  console.error(
    `opencode-cost zen-sync: parsed ${resp.usage.length} usage row(s), ` +
    `${resp.keys.length} key(s).`,
  )

  if (parsed.dryRun) {
    process.stdout.write(JSON.stringify(resp, null, 2))
    process.stdout.write("\n")
    return 0
  }

  let db: Database
  try {
    // `readwrite: true` opens existing-only — fails if the DB hasn't been
    // created yet (which is the plugin's responsibility on first run).
    // Don't fall through to `{ create: true }`: a silently-created empty
    // DB would mask "plugin never ran" misconfigurations.
    db = new Database(DB_PATH, { readwrite: true })
  } catch (e: any) {
    console.error(
      `opencode-cost zen-sync: cannot open ${DB_PATH} (${e?.message ?? e}).\n` +
      `Run an opencode session first to create the DB.`,
    )
    return 1
  }

  try {
    const { written } = upsertRows(db, resp.usage)
    console.error(
      `opencode-cost zen-sync: wrote ${written} row(s) to zen_daily_billed.`,
    )
    return 0
  } catch (e: any) {
    console.error(`opencode-cost zen-sync: DB write failed (${e?.message ?? e})`)
    return 1
  } finally {
    db.close()
  }
}
