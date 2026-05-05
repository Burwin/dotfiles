// toggl-group.lib.ts — pure functions that turn `.toggl-time` JSONL heartbeats
// into time entries grouped by (project_id, task), merging short idle gaps.
//
// The `.toggl-time` file is written by the opencode plugin in
// `opencode/.config/opencode/plugins/toggl-time.ts`. Each line records a
// transition between busy and waiting. We treat every event as a heartbeat:
// proof the agent (or user, since the user is typing during "idle") was
// active at that moment. If two consecutive heartbeats on the same
// (project_id, task) are within `bufferMs`, they belong to the same entry —
// the gap between them is "thinking time" and counts as work.
//
// Contract:
//   1. Pure. No filesystem or network I/O. Caller passes the raw JSONL string.
//   2. Stable. Same input → same output, regardless of host TZ unless
//      `splitAtLocalMidnight` is true and `timeZone` defaults to local.
//   3. Forgiving. Malformed lines are reported via `warnings`, not thrown.
//
// See ../../TESTS.md and ./toggl-group.test.ts for behavior fixtures.

export type Heartbeat = {
  ts: string // ISO 8601 UTC, e.g. "2026-05-05T17:21:42.619Z"
  event: "start" | "pause"
  trigger: string
  session_id?: string
  client_name: string
  project_id: number
  project_name: string
  task: string
  details?: Record<string, unknown>
}

export type Entry = {
  start: string // ISO UTC
  end: string // ISO UTC
  duration_ms: number
  project_id: number
  project_name: string
  client_name: string
  task: string
  session_ids: string[]
  event_count: number
  busy_ms: number // sum of (start → next event) spans
  absorbed_idle_ms: number // sum of (pause → next event) gaps below buffer
  split?: "midnight"
}

export type GroupOptions = {
  bufferMs: number
  splitAtLocalMidnight: boolean
  timeZone: string
}

export const DEFAULT_BUFFER_MS = 10 * 60 * 1000

export const defaultOptions = (): GroupOptions => ({
  bufferMs: DEFAULT_BUFFER_MS,
  splitAtLocalMidnight: true,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
})

// parseHeartbeats — parses a JSONL string into Heartbeat records. Skips blank
// lines silently. Lines that fail JSON.parse, or that lack the required
// fields, are reported in `warnings` (1-indexed line numbers) and dropped.
export function parseHeartbeats(jsonl: string): {
  events: Heartbeat[]
  warnings: string[]
} {
  const events: Heartbeat[] = []
  const warnings: string[] = []
  const lines = jsonl.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (raw === undefined) continue
    const line = raw.trim()
    if (line === "") continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (e) {
      warnings.push(`line ${i + 1}: invalid JSON (${(e as Error).message})`)
      continue
    }
    if (!parsed || typeof parsed !== "object") {
      warnings.push(`line ${i + 1}: not an object`)
      continue
    }
    const o = parsed as Record<string, unknown>
    if (
      typeof o.ts !== "string" ||
      (o.event !== "start" && o.event !== "pause") ||
      typeof o.trigger !== "string" ||
      typeof o.client_name !== "string" ||
      typeof o.project_id !== "number" ||
      typeof o.project_name !== "string" ||
      typeof o.task !== "string"
    ) {
      warnings.push(`line ${i + 1}: missing or invalid required fields`)
      continue
    }
    // Validate ISO ts is parseable.
    const ms = Date.parse(o.ts)
    if (Number.isNaN(ms)) {
      warnings.push(`line ${i + 1}: unparseable ts ${JSON.stringify(o.ts)}`)
      continue
    }
    events.push({
      ts: o.ts,
      event: o.event,
      trigger: o.trigger,
      session_id: typeof o.session_id === "string" ? o.session_id : undefined,
      client_name: o.client_name,
      project_id: o.project_id,
      project_name: o.project_name,
      task: o.task,
      details:
        o.details && typeof o.details === "object"
          ? (o.details as Record<string, unknown>)
          : undefined,
    })
  }
  return { events, warnings }
}

// groupEvents — collapses sorted heartbeats into Entry records. Splits when
// the (project_id, task) tuple changes, when the inter-event gap exceeds
// bufferMs, or (post-process) when an entry crosses local-TZ midnight.
//
// Trailing `start` events with no following heartbeat are trimmed from the
// resulting entry; if trimming empties the entry, it is dropped entirely.
export function groupEvents(
  events: Heartbeat[],
  opts: Partial<GroupOptions> = {},
): Entry[] {
  const o = { ...defaultOptions(), ...opts }

  // 1. Sort + dedupe. Heartbeats with the same (ts, event, trigger,
  //    session_id) are treated as one. Lines 43-45 of the live .toggl-time
  //    are the canonical example: three pauses fired within 9ms.
  const sorted = [...events].sort((a, b) => {
    const da = Date.parse(a.ts) - Date.parse(b.ts)
    if (da !== 0) return da
    // Stable secondary sort so dedupe is deterministic.
    return (
      a.event.localeCompare(b.event) ||
      a.trigger.localeCompare(b.trigger) ||
      (a.session_id ?? "").localeCompare(b.session_id ?? "")
    )
  })
  const deduped: Heartbeat[] = []
  for (const e of sorted) {
    const prev = deduped[deduped.length - 1]
    if (
      prev &&
      prev.ts === e.ts &&
      prev.event === e.event &&
      prev.trigger === e.trigger &&
      prev.session_id === e.session_id &&
      prev.project_id === e.project_id &&
      prev.task === e.task
    ) {
      continue
    }
    deduped.push(e)
  }

  // 2. Walk and group. An entry stays open while events arrive on the same
  //    (project_id, task) within bufferMs. Otherwise we close the open entry
  //    and start a new one.
  type Open = {
    events: Heartbeat[]
    lastSeenMs: number
    busyMs: number
    absorbedIdleMs: number
  }
  let open: Open | null = null
  const closed: Entry[] = []

  const closeOpen = () => {
    if (!open) return
    // Trim trailing `start` events. They represent an entry that has no
    // closing heartbeat; we don't know when work actually ended.
    while (
      open.events.length > 0 &&
      open.events[open.events.length - 1]!.event === "start"
    ) {
      open.events.pop()
    }
    if (open.events.length === 0) {
      open = null
      return
    }
    const first = open.events[0]!
    const last = open.events[open.events.length - 1]!
    const startMs = Date.parse(first.ts)
    const endMs = Date.parse(last.ts)
    const sessions: string[] = []
    for (const ev of open.events) {
      if (ev.session_id && !sessions.includes(ev.session_id)) {
        sessions.push(ev.session_id)
      }
    }
    closed.push({
      start: first.ts,
      end: last.ts,
      duration_ms: endMs - startMs,
      project_id: first.project_id,
      project_name: first.project_name,
      client_name: first.client_name,
      task: first.task,
      session_ids: sessions,
      event_count: open.events.length,
      busy_ms: open.busyMs,
      absorbed_idle_ms: open.absorbedIdleMs,
    })
    open = null
  }

  for (const ev of deduped) {
    const tsMs = Date.parse(ev.ts)
    if (open) {
      const prev = open.events[open.events.length - 1]!
      const sameKey =
        prev.project_id === ev.project_id && prev.task === ev.task
      const gap = tsMs - open.lastSeenMs
      if (!sameKey || gap > o.bufferMs) {
        closeOpen()
      } else {
        // Same entry continues. Attribute the gap to busy_ms or
        // absorbed_idle_ms based on the prior event's role.
        if (prev.event === "start") {
          open.busyMs += gap
        } else {
          open.absorbedIdleMs += gap
        }
        open.events.push(ev)
        open.lastSeenMs = tsMs
        continue
      }
    }
    open = {
      events: [ev],
      lastSeenMs: tsMs,
      busyMs: 0,
      absorbedIdleMs: 0,
    }
  }
  closeOpen()

  // 3. Day-boundary post-process.
  if (!o.splitAtLocalMidnight) return closed
  const split: Entry[] = []
  for (const entry of closed) {
    split.push(...splitEntryAtMidnight(entry, o.timeZone))
  }
  return split
}

// splitEntryAtMidnight — slices an entry at every local-TZ midnight that
// falls inside [start, end). Diagnostic counters (event_count, busy_ms,
// absorbed_idle_ms, session_ids) attach to the first slice; subsequent
// slices are zero/empty on those fields and tagged `split: "midnight"`.
//
// This honest-attribution choice (vs. pro-rating by time fraction) keeps
// the diagnostic numbers aligned with the original event stream and avoids
// fractional event counts.
export function splitEntryAtMidnight(entry: Entry, timeZone: string): Entry[] {
  const startMs = Date.parse(entry.start)
  const endMs = Date.parse(entry.end)
  if (endMs <= startMs) return [entry]

  const boundaries: number[] = []
  // Walk forward by one local day at a time. Compute "next local midnight
  // strictly after startMs" by reading the local date of startMs, advancing
  // a day, and converting that local 00:00 back to UTC.
  let cursor = nextLocalMidnightUtcMs(startMs, timeZone)
  while (cursor < endMs) {
    boundaries.push(cursor)
    cursor = nextLocalMidnightUtcMs(cursor, timeZone)
  }
  if (boundaries.length === 0) return [entry]

  const slicesMs: Array<[number, number]> = []
  let prev = startMs
  for (const b of boundaries) {
    slicesMs.push([prev, b])
    prev = b
  }
  slicesMs.push([prev, endMs])

  const slices: Entry[] = []
  for (let i = 0; i < slicesMs.length; i++) {
    const [s, e] = slicesMs[i]!
    const isFirst = i === 0
    slices.push({
      start: new Date(s).toISOString(),
      end: new Date(e).toISOString(),
      duration_ms: e - s,
      project_id: entry.project_id,
      project_name: entry.project_name,
      client_name: entry.client_name,
      task: entry.task,
      session_ids: isFirst ? entry.session_ids : [],
      event_count: isFirst ? entry.event_count : 0,
      busy_ms: isFirst ? entry.busy_ms : 0,
      absorbed_idle_ms: isFirst ? entry.absorbed_idle_ms : 0,
      split: "midnight",
    })
  }
  return slices
}

// nextLocalMidnightUtcMs — given a UTC epoch ms and an IANA TZ, returns the
// UTC epoch ms of the next local midnight strictly after the input. Walks
// the local calendar by one day, then resolves that local 00:00 back to UTC
// via `localMidnightUtcMs`. Handles DST because `localMidnightUtcMs` re-
// reads the offset through `Intl` on every step.
function nextLocalMidnightUtcMs(utcMs: number, timeZone: string): number {
  const parts = formatLocalParts(utcMs, timeZone)
  // `Date.UTC` happily normalizes day overflow (e.g. May 32 → Jun 1). We
  // pull the normalized Y/M/D back out of a UTC Date constructed from the
  // raw next-day fields, then resolve that local date to its UTC instant.
  const norm = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + 1),
  )
  return localMidnightUtcMs(
    norm.getUTCFullYear(),
    norm.getUTCMonth() + 1,
    norm.getUTCDate(),
    timeZone,
  )
}

// localMidnightUtcMs — for a given local calendar date and IANA TZ, returns
// the UTC epoch ms of local 00:00 on that date. Iterates by reading the
// local clock at the current guess and shifting by the observed drift; two
// passes are sufficient for any real-world TZ offset, but we cap at 4 for
// safety.
function localMidnightUtcMs(
  year: number,
  month: number, // 1-12
  day: number,
  timeZone: string,
): number {
  let guessMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0)
  const targetUtcMs = guessMs
  for (let i = 0; i < 4; i++) {
    const parts = formatLocalParts(guessMs, timeZone)
    if (
      parts.year === year &&
      parts.month === month &&
      parts.day === day &&
      parts.hour === 0 &&
      parts.minute === 0 &&
      parts.second === 0
    ) {
      return guessMs
    }
    const observedUtcMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      0,
    )
    guessMs -= observedUtcMs - targetUtcMs
  }
  return guessMs
}

type LocalParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

// Cache the formatter per timezone — Intl.DateTimeFormat construction is
// surprisingly expensive when called in a tight loop.
const formatterCache = new Map<string, Intl.DateTimeFormat>()
function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    formatterCache.set(timeZone, f)
  }
  return f
}

function formatLocalParts(utcMs: number, timeZone: string): LocalParts {
  const parts = getFormatter(timeZone).formatToParts(new Date(utcMs))
  const lookup: Record<string, string> = {}
  for (const p of parts) lookup[p.type] = p.value
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour: Number(lookup.hour) % 24, // h23 emits 0-23, but be safe
    minute: Number(lookup.minute),
    second: Number(lookup.second),
  }
}

// formatLocalDate / formatLocalTime — table-rendering helpers, exposed so the
// CLI and tests share a single rendering implementation.
export function formatLocalDate(utcIso: string, timeZone: string): string {
  const p = formatLocalParts(Date.parse(utcIso), timeZone)
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`
}

export function formatLocalTime(utcIso: string, timeZone: string): string {
  const p = formatLocalParts(Date.parse(utcIso), timeZone)
  return `${pad2(p.hour)}:${pad2(p.minute)}`
}

export function formatDuration(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

// filterByWindow — keeps entries whose [start, end] overlaps [sinceMs,
// untilMs]. Either bound may be null/undefined for "open".
export function filterByWindow(
  entries: Entry[],
  sinceMs: number | null | undefined,
  untilMs: number | null | undefined,
): Entry[] {
  return entries.filter((e) => {
    const s = Date.parse(e.start)
    const en = Date.parse(e.end)
    if (sinceMs != null && en < sinceMs) return false
    if (untilMs != null && s > untilMs) return false
    return true
  })
}
