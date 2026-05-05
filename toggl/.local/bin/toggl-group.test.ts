// toggl-group.test.ts — bun:test unit suite for ./toggl-group.lib.ts.
//
// Run from the repo root: `bun test toggl/.local/bin/toggl-group.test.ts`.
//
// Fixtures live in ../../test-fixtures/ relative to this file. Inline mini-
// fixtures are used for behaviors that are easier to reason about as JSON
// strings constructed by the `event(...)` and `jsonl(...)` helpers below.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  DEFAULT_BUFFER_MS,
  filterByWindow,
  formatDuration,
  formatLocalDate,
  formatLocalTime,
  groupEvents,
  heartbeatsFromRows,
  type HeartbeatRow,
  parseHeartbeats,
  splitEntryAtMidnight,
} from "./toggl-group.lib.ts"

// Layout: toggl/.local/bin/<this file>, toggl/test-fixtures/<fixtures>.
// `..` → .local, `../..` → toggl, `../../test-fixtures/` → fixtures dir.
const fixturesDir = new URL("../../test-fixtures/", import.meta.url)
const SYNTHETIC = readFileSync(
  new URL("heartbeats-synthetic.jsonl", fixturesDir),
  "utf8",
)
const LIVE = readFileSync(
  new URL("heartbeats-live.jsonl", fixturesDir),
  "utf8",
)

// event(overrides) — single JSONL line, defaults to a valid TASK-X start.
const event = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    ts: "2026-01-01T00:00:00.000Z",
    event: "start",
    trigger: "chat.message",
    session_id: "ses_X",
    client_name: "Acme",
    project_id: 1,
    project_name: "Alpha",
    task: "TASK-X",
    ...overrides,
  })

// jsonl(...lines) — joins inline events with newlines (no trailing newline).
const jsonl = (...lines: string[]): string => lines.join("\n")

describe("parseHeartbeats", () => {
  test("empty string → no events, no warnings", () => {
    expect(parseHeartbeats("")).toEqual({ events: [], warnings: [] })
  })

  test("blank lines are skipped silently", () => {
    const r = parseHeartbeats("\n\n\n")
    expect(r.events).toEqual([])
    expect(r.warnings).toEqual([])
  })

  test("synthetic fixture: 8 events, no warnings, fields preserved", () => {
    const r = parseHeartbeats(SYNTHETIC)
    expect(r.warnings).toEqual([])
    expect(r.events).toHaveLength(8)
    expect(r.events[0]).toEqual({
      ts: "2026-01-15T10:00:00.000Z",
      event: "start",
      trigger: "chat.message",
      session_id: "ses_A",
      client_name: "Acme",
      project_id: 1,
      project_name: "Alpha",
      task: "TASK-1",
      details: undefined,
    })
  })

  test("live fixture: 92 events, no warnings", () => {
    const r = parseHeartbeats(LIVE)
    expect(r.warnings).toEqual([])
    expect(r.events).toHaveLength(92)
  })

  test("invalid JSON line → 1-based warning, valid line still parsed", () => {
    const r = parseHeartbeats(`not json\n${event()}`)
    expect(r.events).toHaveLength(1)
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatch(/^line 1: invalid JSON/)
  })

  test("missing required fields → warning", () => {
    const r = parseHeartbeats('{"ts":"2026-01-01T00:00:00.000Z","event":"start"}')
    expect(r.events).toEqual([])
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatch(/missing or invalid required fields/)
  })

  test("non-object literals → 'not an object' warning", () => {
    const r = parseHeartbeats(jsonl("123", "null", '"x"'))
    expect(r.events).toEqual([])
    expect(r.warnings).toHaveLength(3)
    for (const w of r.warnings) expect(w).toMatch(/not an object/)
  })

  test("array literal → 'missing required fields' (typeof [] is object)", () => {
    const r = parseHeartbeats("[1,2,3]")
    expect(r.events).toEqual([])
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatch(/missing or invalid required fields/)
  })

  test("unparseable ts → warning", () => {
    const r = parseHeartbeats(event({ ts: "not-a-date" }))
    expect(r.events).toEqual([])
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatch(/unparseable ts/)
  })

  test("invalid `event` value → warning", () => {
    const r = parseHeartbeats(event({ event: "wat" }))
    expect(r.events).toEqual([])
    expect(r.warnings).toHaveLength(1)
  })

  test("session_id is optional", () => {
    const e = event()
    const o = JSON.parse(e)
    delete o.session_id
    const r = parseHeartbeats(JSON.stringify(o))
    expect(r.warnings).toEqual([])
    expect(r.events).toHaveLength(1)
    expect(r.events[0]?.session_id).toBeUndefined()
  })

  test("details is preserved when present and an object", () => {
    const r = parseHeartbeats(event({ details: { agent: "plan" } }))
    expect(r.events[0]?.details).toEqual({ agent: "plan" })
  })

  test("details is dropped when not an object", () => {
    const r = parseHeartbeats(event({ details: "string-not-object" }))
    expect(r.events[0]?.details).toBeUndefined()
  })
})

describe("heartbeatsFromRows", () => {
  // row(overrides) — single SELECT-shaped row with sane defaults. Column
  // shape mirrors the actual `bun:sqlite` output: NULL columns appear as
  // `null`, numbers as numbers, JSON details as a TEXT string.
  const row = (overrides: Partial<HeartbeatRow> = {}): HeartbeatRow => ({
    ts: "2026-01-01T00:00:00.000Z",
    event: "start",
    trigger: "chat.message",
    session_id: "ses_X",
    client_name: "Acme",
    project_id: 1,
    project_name: "Alpha",
    task: "TASK-X",
    details: null,
    ...overrides,
  })

  test("empty input → no events, no warnings", () => {
    expect(heartbeatsFromRows([])).toEqual({ events: [], warnings: [] })
  })

  test("minimal row with NULL details → details undefined", () => {
    const r = heartbeatsFromRows([row()])
    expect(r.warnings).toEqual([])
    expect(r.events).toHaveLength(1)
    expect(r.events[0]?.details).toBeUndefined()
    expect(r.events[0]?.session_id).toBe("ses_X")
  })

  test("session_id NULL → undefined on the parsed event", () => {
    const r = heartbeatsFromRows([row({ session_id: null })])
    expect(r.warnings).toEqual([])
    expect(r.events[0]?.session_id).toBeUndefined()
  })

  test("valid JSON details TEXT → parsed object", () => {
    const r = heartbeatsFromRows([
      row({ details: '{"agent":"plan","model":{"providerID":"opencode"}}' }),
    ])
    expect(r.warnings).toEqual([])
    expect(r.events[0]?.details).toEqual({
      agent: "plan",
      model: { providerID: "opencode" },
    })
  })

  test("invalid JSON details TEXT → warning + details undefined", () => {
    const r = heartbeatsFromRows([row({ details: "{not json" })])
    expect(r.events).toHaveLength(1)
    expect(r.events[0]?.details).toBeUndefined()
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatch(/^row 1: invalid JSON in details/)
  })

  test("JSON details that is not an object → details undefined, no warning", () => {
    // Arrays and primitives are valid JSON but not the shape we promise to
    // expose as Heartbeat.details (Record<string, unknown>). Drop silently.
    const r = heartbeatsFromRows([row({ details: "[1,2,3]" })])
    expect(r.warnings).toEqual([])
    expect(r.events[0]?.details).toBeUndefined()
  })

  test("empty-string details → undefined, no warning", () => {
    const r = heartbeatsFromRows([row({ details: "" })])
    expect(r.warnings).toEqual([])
    expect(r.events[0]?.details).toBeUndefined()
  })

  test("missing required field → row warning, row dropped", () => {
    const r = heartbeatsFromRows([row({ project_id: null as unknown as number })])
    expect(r.events).toEqual([])
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatch(/^row 1: missing or invalid required fields/)
  })

  test("invalid event value → warning, row dropped", () => {
    const r = heartbeatsFromRows([row({ event: "wat" as unknown as "start" })])
    expect(r.events).toEqual([])
    expect(r.warnings).toHaveLength(1)
  })

  test("unparseable ts → warning, row dropped", () => {
    const r = heartbeatsFromRows([row({ ts: "nope" })])
    expect(r.events).toEqual([])
    expect(r.warnings[0]).toMatch(/^row 1: unparseable ts/)
  })

  test("warning row index is 1-based across mixed input", () => {
    const r = heartbeatsFromRows([
      row(),
      row({ event: "wat" as unknown as "start" }),
      row(),
    ])
    expect(r.events).toHaveLength(2)
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatch(/^row 2:/)
  })
})

describe("groupEvents — synthetic fixture", () => {
  test("default buffer (10 min) → 3 entries (TASK-1 splits at 12-min gap)", () => {
    const { events } = parseHeartbeats(SYNTHETIC)
    const entries = groupEvents(events, { splitAtLocalMidnight: false })
    expect(entries).toHaveLength(3)

    // Entry 1: TASK-1 events 1-4 (10:00:00 → 10:08:30).
    expect(entries[0]).toMatchObject({
      task: "TASK-1",
      start: "2026-01-15T10:00:00.000Z",
      end: "2026-01-15T10:08:30.000Z",
      duration_ms: 510_000,
      event_count: 4,
      busy_ms: 35_000, // (10:00:00→10:00:05)=5s + (10:08:00→10:08:30)=30s
      absorbed_idle_ms: 475_000, // (10:00:05→10:08:00)=7m55s
      session_ids: ["ses_A"],
    })

    // Entry 2: TASK-1 events 5-6 (10:20:30 → 10:20:45) — separate after split.
    expect(entries[1]).toMatchObject({
      task: "TASK-1",
      start: "2026-01-15T10:20:30.000Z",
      end: "2026-01-15T10:20:45.000Z",
      duration_ms: 15_000,
      busy_ms: 15_000,
      absorbed_idle_ms: 0,
    })

    // Entry 3: TASK-2 (different task → separate entry).
    expect(entries[2]).toMatchObject({
      task: "TASK-2",
      duration_ms: 33_000,
      busy_ms: 33_000,
      session_ids: ["ses_B"],
    })
  })

  test("buffer 15 min → 2 entries (TASK-1 fully merges)", () => {
    const { events } = parseHeartbeats(SYNTHETIC)
    const entries = groupEvents(events, {
      bufferMs: 15 * 60 * 1000,
      splitAtLocalMidnight: false,
    })
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      task: "TASK-1",
      start: "2026-01-15T10:00:00.000Z",
      end: "2026-01-15T10:20:45.000Z",
      duration_ms: 1_245_000,
      event_count: 6,
      busy_ms: 50_000, // 5+30+15 across the three start→pause spans
      absorbed_idle_ms: 1_195_000, // 475 + 720 across the two pause→start gaps
    })
    expect(entries[1]?.task).toBe("TASK-2")
  })
})

describe("groupEvents — live fixture", () => {
  test("default buffer → 4 entries: 1608, 1621, 1607, 1607", () => {
    const { events } = parseHeartbeats(LIVE)
    const entries = groupEvents(events, { splitAtLocalMidnight: false })
    const tasks = entries.map((e) => e.task)
    expect(tasks).toEqual([
      "MASTER-1608",
      "MASTER-1621",
      "MASTER-1607",
      "MASTER-1607",
    ])

    // MASTER-1608 absorbs 75 events without splitting (no internal gap > 10m).
    expect(entries[0]).toMatchObject({
      task: "MASTER-1608",
      start: "2026-05-05T17:21:42.619Z",
      end: "2026-05-05T18:14:35.854Z",
      event_count: 75,
      session_ids: ["ses_206ec134dffeMn6e9MzubjEuW2"],
    })

    // MASTER-1607 splits at the 13-min gap between question.asked and
    // question.replied (18:25:25 → 18:38:42).
    expect(entries[2]?.end).toBe("2026-05-05T18:25:25.694Z")
    expect(entries[3]?.start).toBe("2026-05-05T18:38:42.624Z")

    // The trailing `start` event of the file (line 92, 18:44:26) is trimmed
    // off the last entry, so end is the prior pause.
    expect(entries[3]?.end).toBe("2026-05-05T18:44:22.058Z")
  })
})

describe("groupEvents — dedupe", () => {
  test("exact duplicate events collapse to one heartbeat", () => {
    const dup = event({ ts: "2026-01-01T00:00:00.000Z", event: "pause" })
    const { events } = parseHeartbeats(jsonl(dup, dup, dup))
    const entries = groupEvents(events, { splitAtLocalMidnight: false })
    // Three identical pauses → after dedupe one heartbeat → trailing pause
    // would close the entry but it's the only event, so still emits one entry
    // with event_count=1.
    expect(entries).toHaveLength(1)
    expect(entries[0]?.event_count).toBe(1)
  })

  test("same ts/event/trigger but different session_id → not deduped", () => {
    const a = event({ event: "pause", session_id: "ses_A" })
    const b = event({ event: "pause", session_id: "ses_B" })
    const { events } = parseHeartbeats(jsonl(a, b))
    const entries = groupEvents(events, { splitAtLocalMidnight: false })
    expect(entries[0]?.event_count).toBe(2)
  })
})

describe("groupEvents — edge cases", () => {
  test("trailing `start` with no following heartbeat is trimmed", () => {
    const { events } = parseHeartbeats(
      jsonl(
        event({ ts: "2026-01-01T10:00:00.000Z", event: "start" }),
        event({ ts: "2026-01-01T10:00:30.000Z", event: "pause" }),
        event({ ts: "2026-01-01T10:01:00.000Z", event: "start" }),
      ),
    )
    const entries = groupEvents(events, { splitAtLocalMidnight: false })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.event_count).toBe(2)
    expect(entries[0]?.end).toBe("2026-01-01T10:00:30.000Z")
  })

  test("entry with only a single `start` is dropped after trim", () => {
    const { events } = parseHeartbeats(
      event({ ts: "2026-01-01T10:00:00.000Z", event: "start" }),
    )
    const entries = groupEvents(events, { splitAtLocalMidnight: false })
    expect(entries).toEqual([])
  })

  test("task change inside the buffer window splits the entry", () => {
    const { events } = parseHeartbeats(
      jsonl(
        event({ ts: "2026-01-01T10:00:00.000Z", event: "start", task: "A" }),
        event({ ts: "2026-01-01T10:00:30.000Z", event: "pause", task: "A" }),
        event({ ts: "2026-01-01T10:01:00.000Z", event: "start", task: "B" }),
        event({ ts: "2026-01-01T10:01:30.000Z", event: "pause", task: "B" }),
      ),
    )
    const entries = groupEvents(events, { splitAtLocalMidnight: false })
    expect(entries).toHaveLength(2)
    expect(entries[0]?.task).toBe("A")
    expect(entries[1]?.task).toBe("B")
  })

  test("gap exactly equal to bufferMs joins (boundary)", () => {
    const { events } = parseHeartbeats(
      jsonl(
        event({ ts: "2026-01-01T10:00:00.000Z", event: "pause" }),
        event({
          ts: new Date(
            Date.parse("2026-01-01T10:00:00.000Z") + DEFAULT_BUFFER_MS,
          ).toISOString(),
          event: "start",
        }),
        event({
          ts: new Date(
            Date.parse("2026-01-01T10:00:00.000Z") + DEFAULT_BUFFER_MS + 1000,
          ).toISOString(),
          event: "pause",
        }),
      ),
    )
    const entries = groupEvents(events, { splitAtLocalMidnight: false })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.event_count).toBe(3)
  })

  test("gap one ms over bufferMs splits", () => {
    const { events } = parseHeartbeats(
      jsonl(
        event({ ts: "2026-01-01T10:00:00.000Z", event: "pause" }),
        event({
          ts: new Date(
            Date.parse("2026-01-01T10:00:00.000Z") + DEFAULT_BUFFER_MS + 1,
          ).toISOString(),
          event: "start",
        }),
        event({
          ts: new Date(
            Date.parse("2026-01-01T10:00:00.000Z") + DEFAULT_BUFFER_MS + 2_000,
          ).toISOString(),
          event: "pause",
        }),
      ),
    )
    const entries = groupEvents(events, { splitAtLocalMidnight: false })
    // Entry 1 (events[0]) is a lone trailing-pause-only entry — kept because
    // the trim only removes trailing `start`s, not lone `pause`s.
    expect(entries).toHaveLength(2)
    expect(entries[0]?.event_count).toBe(1)
    expect(entries[1]?.event_count).toBe(2)
  })
})

describe("splitEntryAtMidnight", () => {
  // Use a fixed IANA TZ so DST/host-tz doesn't make these tests flaky.
  const TZ = "America/New_York" // UTC-5 EST in January

  const baseEntry = (start: string, end: string) => ({
    start,
    end,
    duration_ms: Date.parse(end) - Date.parse(start),
    project_id: 1,
    project_name: "Alpha",
    client_name: "Acme",
    task: "TASK-X",
    session_ids: ["ses_X"],
    event_count: 5,
    busy_ms: 100,
    absorbed_idle_ms: 50,
  })

  test("entry that doesn't cross midnight returns [entry] unchanged", () => {
    // 14:00 → 16:00 EST on 2026-01-15 = 19:00 → 21:00 UTC.
    const entry = baseEntry("2026-01-15T19:00:00.000Z", "2026-01-15T21:00:00.000Z")
    const slices = splitEntryAtMidnight(entry, TZ)
    expect(slices).toEqual([entry])
  })

  test("single midnight crossing yields 2 slices", () => {
    // 22:00 EST on 2026-01-14 = 03:00 UTC on 2026-01-15.
    // 02:00 EST on 2026-01-15 = 07:00 UTC on 2026-01-15.
    // Local midnight in EST = 05:00 UTC on 2026-01-15.
    const entry = baseEntry("2026-01-15T03:00:00.000Z", "2026-01-15T07:00:00.000Z")
    const slices = splitEntryAtMidnight(entry, TZ)
    expect(slices).toHaveLength(2)
    expect(slices[0]).toMatchObject({
      start: "2026-01-15T03:00:00.000Z",
      end: "2026-01-15T05:00:00.000Z",
      duration_ms: 2 * 60 * 60 * 1000,
      event_count: 5,
      busy_ms: 100,
      absorbed_idle_ms: 50,
      session_ids: ["ses_X"],
      split: "midnight",
    })
    expect(slices[1]).toMatchObject({
      start: "2026-01-15T05:00:00.000Z",
      end: "2026-01-15T07:00:00.000Z",
      duration_ms: 2 * 60 * 60 * 1000,
      event_count: 0,
      busy_ms: 0,
      absorbed_idle_ms: 0,
      session_ids: [],
      split: "midnight",
    })
  })

  test("multi-day entry splits at every local midnight", () => {
    // 22:00 EST on 2026-01-14 = 03:00 UTC on 2026-01-15.
    // 22:00 EST on 2026-01-16 = 03:00 UTC on 2026-01-17.
    // Crosses midnight twice (15→16, 16→17 in EST).
    const entry = baseEntry("2026-01-15T03:00:00.000Z", "2026-01-17T03:00:00.000Z")
    const slices = splitEntryAtMidnight(entry, TZ)
    expect(slices).toHaveLength(3)
    expect(slices[0]?.start).toBe("2026-01-15T03:00:00.000Z")
    expect(slices[0]?.end).toBe("2026-01-15T05:00:00.000Z")
    expect(slices[1]?.start).toBe("2026-01-15T05:00:00.000Z")
    expect(slices[1]?.end).toBe("2026-01-16T05:00:00.000Z")
    expect(slices[2]?.start).toBe("2026-01-16T05:00:00.000Z")
    expect(slices[2]?.end).toBe("2026-01-17T03:00:00.000Z")
    // Diagnostics only on the first slice.
    expect(slices[0]?.event_count).toBe(5)
    expect(slices[1]?.event_count).toBe(0)
    expect(slices[2]?.event_count).toBe(0)
  })

  test("entry where end<=start returns [entry] (defensive)", () => {
    const entry = baseEntry("2026-01-15T03:00:00.000Z", "2026-01-15T03:00:00.000Z")
    expect(splitEntryAtMidnight(entry, TZ)).toEqual([entry])
  })
})

describe("filterByWindow", () => {
  const e = (start: string, end: string) => ({
    start,
    end,
    duration_ms: Date.parse(end) - Date.parse(start),
    project_id: 1,
    project_name: "Alpha",
    client_name: "Acme",
    task: "T",
    session_ids: [],
    event_count: 1,
    busy_ms: 0,
    absorbed_idle_ms: 0,
  })
  const a = e("2026-01-01T10:00:00.000Z", "2026-01-01T11:00:00.000Z")
  const b = e("2026-01-02T10:00:00.000Z", "2026-01-02T11:00:00.000Z")
  const c = e("2026-01-03T10:00:00.000Z", "2026-01-03T11:00:00.000Z")

  test("null bounds keep everything", () => {
    expect(filterByWindow([a, b, c], null, null)).toEqual([a, b, c])
  })

  test("since cuts off entries that ended before it", () => {
    const since = Date.parse("2026-01-02T00:00:00.000Z")
    expect(filterByWindow([a, b, c], since, null)).toEqual([b, c])
  })

  test("until cuts off entries that started after it", () => {
    const until = Date.parse("2026-01-02T23:59:59.999Z")
    expect(filterByWindow([a, b, c], null, until)).toEqual([a, b])
  })

  test("partial overlap is kept", () => {
    const since = Date.parse("2026-01-01T10:30:00.000Z")
    const until = Date.parse("2026-01-01T10:45:00.000Z")
    expect(filterByWindow([a, b, c], since, until)).toEqual([a])
  })
})

describe("formatters", () => {
  test("formatDuration", () => {
    expect(formatDuration(0)).toBe("00:00:00")
    expect(formatDuration(1_000)).toBe("00:00:01")
    expect(formatDuration(60_000)).toBe("00:01:00")
    expect(formatDuration(3_600_000)).toBe("01:00:00")
    // >24h durations should NOT roll over the day; we expect 25:00:00.
    expect(formatDuration(25 * 3_600_000)).toBe("25:00:00")
    // Negative ms is clamped to 00:00:00 by the lib's `Math.max(0, …)`.
    expect(formatDuration(-1)).toBe("00:00:00")
  })

  test("formatLocalDate / formatLocalTime", () => {
    // Pick a known UTC instant and a TZ where the local rendering is fixed.
    const utc = "2026-01-15T19:00:00.000Z" // 14:00 in America/New_York (EST)
    expect(formatLocalDate(utc, "America/New_York")).toBe("2026-01-15")
    expect(formatLocalTime(utc, "America/New_York")).toBe("14:00")
    // UTC TZ should round-trip the values exactly.
    expect(formatLocalDate(utc, "UTC")).toBe("2026-01-15")
    expect(formatLocalTime(utc, "UTC")).toBe("19:00")
  })
})

describe("DEFAULT_BUFFER_MS", () => {
  test("is exported as 10 minutes", () => {
    expect(DEFAULT_BUFFER_MS).toBe(10 * 60 * 1000)
  })
})
