// notify/notify.test.ts — bun:test suite for ./lib.ts and the parse-check
// for the plugin entrypoint at ../notify.ts. Replaces the automatable subset
// of the manual verification steps formerly listed in
// docs/archive/opencode/PLAN-ntfy.md and PLAN-dismiss.md.
//
// Lives in this `notify/` subdirectory (not at plugins/ top level) because
// opencode's plugin loader uses the non-recursive glob
// `{plugin,plugins}/*.{ts,js}` and would otherwise try to load this test
// file as a Plugin, which fails with "Cannot use describe outside of the
// test runner."
//
// Run from the repo root: `bun test ./opencode/.config/opencode/plugins/`.
//
// What's covered here:
//   - dispatchEvent: pure mapping correctness for every documented event
//     branch + the dismiss-default + noop fall-through cases.
//   - pingNtfy: the no-op-when-topic-unset contract, error swallowing, URL
//     encoding, header construction (Title/Tags/Authorization).
//   - makeDismissTracker: add → dismissAll calls the injected dismiss once
//     per id, per-session isolation, error tolerance.
//   - tmuxSlug: marker-filename sanitization, incl. the `/` and `..`
//     path-traversal guard and pass-through of conventional names.
//   - ../notify.ts: parse / typecheck via `bun build --no-bundle` so the
//     entrypoint can't drift away from the lib's API silently.
//
// What's NOT covered here (still manual eyeball checks; see PLAN docs):
//   - Visual mako toast appearing/disappearing.
//   - ntfy phone push reaching a subscribed device.
//   - End-to-end "submit prompt → toast disappears" with the live opencode
//     runtime.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import {
  dispatchEvent,
  makeDismissTracker,
  pingNtfy,
  tmuxSlug,
  type NtfyConfig,
} from "./lib.ts"

describe("dispatchEvent", () => {
  const titleBase = "TestTitle"

  test("session.idle → notify with normal urgency, robot tag", () => {
    const a = dispatchEvent("session.idle", { sessionID: "S1" }, titleBase)
    expect(a).toEqual({
      kind: "notify",
      urgency: "normal",
      title: "TestTitle",
      body: "Session idle — ready for input",
      tag: "robot",
      sessionID: "S1",
    })
  })

  test("session.error → notify with critical urgency, warning tag", () => {
    const a = dispatchEvent("session.error", { sessionID: "S2" }, titleBase)
    expect(a).toMatchObject({
      kind: "notify",
      urgency: "critical",
      tag: "warning",
      body: "Session error",
      sessionID: "S2",
    })
  })

  test("permission.asked uses v1 `title` when present", () => {
    const a = dispatchEvent(
      "permission.asked",
      { sessionID: "S3", title: "Run rm -rf /" },
      titleBase,
    )
    expect(a).toMatchObject({
      kind: "notify",
      tag: "lock",
      body: "Permission requested: Run rm -rf /",
      sessionID: "S3",
    })
  })

  test("permission.asked falls back to v2 `permission` when no title", () => {
    const a = dispatchEvent(
      "permission.asked",
      { sessionID: "S3", permission: "bash" },
      titleBase,
    )
    expect(a).toMatchObject({
      kind: "notify",
      body: "Permission requested: bash",
    })
  })

  test("permission.asked uses generic body when neither field is set", () => {
    const a = dispatchEvent("permission.asked", { sessionID: "S3" }, titleBase)
    expect(a).toMatchObject({ body: "Permission requested" })
  })

  test("question.asked uses the first question's header", () => {
    const a = dispatchEvent(
      "question.asked",
      { sessionID: "S4", questions: [{ header: "Are you sure?" }] },
      titleBase,
    )
    expect(a).toMatchObject({
      kind: "notify",
      tag: "question",
      body: "Question: Are you sure?",
      sessionID: "S4",
    })
  })

  test("question.asked falls back when header missing", () => {
    const a = dispatchEvent("question.asked", { sessionID: "S4" }, titleBase)
    expect(a).toMatchObject({ body: "Question awaiting answer" })
  })

  test("session.status → noop (avoids race with session.idle)", () => {
    const a = dispatchEvent(
      "session.status",
      { sessionID: "S5", status: { type: "idle" } },
      titleBase,
    )
    expect(a).toEqual({ kind: "noop" })
  })

  test("unknown event with sessionID → dismiss", () => {
    // Mirrors the "agent / user is moving again" semantics — any non-halting
    // event for a known session should clear that session's outstanding toasts.
    const cases = [
      "permission.replied",
      "question.replied",
      "message.updated",
      "tool.execute.before",
      "tool.execute.after",
      "file.watcher.updated", // even infrastructure events with a sessionID
    ]
    for (const t of cases) {
      const a = dispatchEvent(t, { sessionID: "SX" }, titleBase)
      expect(a).toEqual({ kind: "dismiss", sessionID: "SX" })
    }
  })

  test("unknown event without sessionID → noop", () => {
    // Events without a sessionID (installation.updated, server.connected,
    // etc.) shouldn't trigger a dismiss — there's nothing to dismiss.
    expect(dispatchEvent("installation.updated", {}, titleBase)).toEqual({
      kind: "noop",
    })
    expect(dispatchEvent("server.connected", {}, titleBase)).toEqual({
      kind: "noop",
    })
  })

  test("non-string sessionID is ignored", () => {
    // A misbehaving runtime that passes a non-string sessionID should not
    // break dispatch; we treat it as "no session".
    const a = dispatchEvent(
      "tool.execute.before",
      { sessionID: 123 as unknown as string },
      titleBase,
    )
    expect(a).toEqual({ kind: "noop" })
  })
})

describe("tmuxSlug", () => {
  // The slug becomes a filename under ~/.local/state/opencode/paused/, so the
  // security-critical cases are `/` (nesting) and `..` (path traversal).
  test("collapses path separators and traversal to underscores", () => {
    expect(tmuxSlug("a/b")).toBe("a_b")
    expect(tmuxSlug("..")).toBe("__")
    expect(tmuxSlug("../x")).toBe("___x")
  })

  test("replaces spaces and other non-[A-Za-z0-9_-] chars", () => {
    expect(tmuxSlug("my session")).toBe("my_session")
    expect(tmuxSlug("a.b")).toBe("a_b")
    expect(tmuxSlug("café:1")).toBe("caf__1")
  })

  test("passes conventional session names through unchanged", () => {
    expect(tmuxSlug("SH-280")).toBe("SH-280")
    expect(tmuxSlug("MASTER-1771")).toBe("MASTER-1771")
    expect(tmuxSlug("feature_branch-2")).toBe("feature_branch-2")
  })

  test("empty string stays empty", () => {
    expect(tmuxSlug("")).toBe("")
  })
})

describe("pingNtfy", () => {
  // Restore the real `fetch` between tests so a leak from one test can't
  // poison another.
  const realFetch = globalThis.fetch
  let fetchCalls: Array<{
    url: string
    init: RequestInit | undefined
  }>
  let fetchMock: ReturnType<typeof mock>

  beforeEach(() => {
    fetchCalls = []
    fetchMock = mock((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init })
      return Promise.resolve(new Response("", { status: 200 }))
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  test("no-op when topic is unset", async () => {
    const config: NtfyConfig = { server: "https://ntfy.sh" }
    await pingNtfy(config, "title", "body", "robot")
    expect(fetchCalls).toHaveLength(0)
  })

  test("no-op when topic is empty string", async () => {
    const config: NtfyConfig = { server: "https://ntfy.sh", topic: "" }
    await pingNtfy(config, "title", "body")
    expect(fetchCalls).toHaveLength(0)
  })

  test("POSTs to <server>/<topic> with Title + Tags headers", async () => {
    await pingNtfy(
      { server: "https://ntfy.sh", topic: "mytopic" },
      "TheTitle",
      "TheBody",
      "robot",
    )
    expect(fetchCalls).toHaveLength(1)
    const call = fetchCalls[0]!
    expect(call.url).toBe("https://ntfy.sh/mytopic")
    expect(call.init?.method).toBe("POST")
    expect(call.init?.body).toBe("TheBody")
    const headers = call.init?.headers as Record<string, string>
    expect(headers.Title).toBe("TheTitle")
    expect(headers.Tags).toBe("robot")
    expect(headers["Content-Type"]).toBe("text/plain; charset=utf-8")
    expect(headers.Authorization).toBeUndefined()
  })

  test("omits Tags header when not provided", async () => {
    await pingNtfy(
      { server: "https://ntfy.sh", topic: "mytopic" },
      "T",
      "B",
    )
    const headers = fetchCalls[0]!.init?.headers as Record<string, string>
    expect(headers.Tags).toBeUndefined()
  })

  test("includes Bearer Authorization when token is set", async () => {
    await pingNtfy(
      { server: "https://ntfy.sh", topic: "mytopic", token: "supersecret" },
      "T",
      "B",
    )
    const headers = fetchCalls[0]!.init?.headers as Record<string, string>
    expect(headers.Authorization).toBe("Bearer supersecret")
  })

  test("URL-encodes the topic (defensive)", async () => {
    // Real ntfy topics are [A-Za-z0-9_-], but a malformed env shouldn't
    // produce an invalid URL.
    await pingNtfy(
      { server: "https://ntfy.sh", topic: "a b/c?d" },
      "T",
      "B",
    )
    expect(fetchCalls[0]!.url).toBe("https://ntfy.sh/a%20b%2Fc%3Fd")
  })

  test("swallows fetch errors (best-effort contract)", async () => {
    globalThis.fetch = mock(() => {
      throw new Error("connect ECONNREFUSED")
    }) as unknown as typeof fetch
    // Must resolve, never reject.
    await expect(
      pingNtfy(
        { server: "https://ntfy.sh", topic: "mytopic" },
        "T",
        "B",
      ),
    ).resolves.toBeUndefined()
  })

  test("swallows promise rejections from fetch", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("network down")),
    ) as unknown as typeof fetch
    await expect(
      pingNtfy(
        { server: "https://ntfy.sh", topic: "mytopic" },
        "T",
        "B",
      ),
    ).resolves.toBeUndefined()
  })
})

describe("makeDismissTracker", () => {
  test("tryAdd appends; dismissAll fires once per tracked id", async () => {
    const dismissed: number[] = []
    const tracker = makeDismissTracker((id) => {
      dismissed.push(id)
    })
    tracker.tryAdd("S1", 100)
    tracker.tryAdd("S1", 101)
    tracker.tryAdd("S1", 102)
    expect(tracker.count("S1")).toBe(3)
    await tracker.dismissAll("S1")
    expect(dismissed.sort()).toEqual([100, 101, 102])
    // Map cleared after dismissAll.
    expect(tracker.count("S1")).toBe(0)
    expect(tracker.size()).toBe(0)
  })

  test("dismissAll on unknown sessionID is a no-op", async () => {
    const dismissed: number[] = []
    const tracker = makeDismissTracker((id) => {
      dismissed.push(id)
    })
    await tracker.dismissAll("nope")
    expect(dismissed).toEqual([])
  })

  test("dismissAll on empty list is a no-op", async () => {
    const dismissed: number[] = []
    const tracker = makeDismissTracker((id) => {
      dismissed.push(id)
    })
    // No tryAdd → nothing to dismiss.
    await tracker.dismissAll("S1")
    expect(dismissed).toEqual([])
  })

  test("per-session isolation: dismissing A doesn't touch B", async () => {
    const dismissed: number[] = []
    const tracker = makeDismissTracker((id) => {
      dismissed.push(id)
    })
    tracker.tryAdd("A", 1)
    tracker.tryAdd("A", 2)
    tracker.tryAdd("B", 3)
    await tracker.dismissAll("A")
    expect(dismissed.sort()).toEqual([1, 2])
    expect(tracker.count("B")).toBe(1) // B retains its single id
    // Now dismiss B; A should not re-fire.
    await tracker.dismissAll("B")
    expect(dismissed.sort()).toEqual([1, 2, 3])
  })

  test("non-finite ids are silently dropped", () => {
    const tracker = makeDismissTracker(() => {})
    tracker.tryAdd("S1", Number.NaN)
    tracker.tryAdd("S1", Number.POSITIVE_INFINITY)
    tracker.tryAdd("S1", Number.NEGATIVE_INFINITY)
    expect(tracker.count("S1")).toBe(0)
    // A subsequent valid id still lands.
    tracker.tryAdd("S1", 42)
    expect(tracker.count("S1")).toBe(1)
  })

  test("dismissAll deletes BEFORE awaiting (no double-dismiss on re-entry)", async () => {
    // Concurrent dismissAll for the same session must not double-dismiss
    // any id. The map.delete() runs synchronously inside dismissAll before
    // the Promise.all await, so the second caller finds no ids and is a
    // no-op. We verify this directly by reading `count` immediately after
    // launching the first dismiss and asserting the second one fires zero
    // dismisses.
    const dismissed: number[] = []
    const tracker = makeDismissTracker(async (id) => {
      dismissed.push(id)
    })
    tracker.tryAdd("S1", 1)
    tracker.tryAdd("S1", 2)
    const first = tracker.dismissAll("S1")
    // Already cleared synchronously, before any await inside dismissAll.
    expect(tracker.count("S1")).toBe(0)
    const second = tracker.dismissAll("S1")
    await Promise.all([first, second])
    // Each id dismissed exactly once.
    expect(dismissed.sort()).toEqual([1, 2])
  })

  test("a thrown dismiss for one id doesn't poison the others", async () => {
    const dismissed: number[] = []
    const tracker = makeDismissTracker((id) => {
      if (id === 99) throw new Error("stale id")
      dismissed.push(id)
    })
    tracker.tryAdd("S1", 1)
    tracker.tryAdd("S1", 99)
    tracker.tryAdd("S1", 2)
    // Must not reject.
    await expect(tracker.dismissAll("S1")).resolves.toBeUndefined()
    expect(dismissed.sort()).toEqual([1, 2])
  })

  test("a rejected dismiss promise for one id doesn't poison the others", async () => {
    const dismissed: number[] = []
    const tracker = makeDismissTracker((id) => {
      if (id === 99) return Promise.reject(new Error("dbus down"))
      dismissed.push(id)
      return Promise.resolve()
    })
    tracker.tryAdd("S1", 1)
    tracker.tryAdd("S1", 99)
    tracker.tryAdd("S1", 2)
    await expect(tracker.dismissAll("S1")).resolves.toBeUndefined()
    expect(dismissed.sort()).toEqual([1, 2])
  })
})

describe("notify.ts entrypoint", () => {
  test("parses cleanly via bun build", () => {
    // The plugin entrypoint imports `@opencode-ai/plugin`, so this also
    // verifies the runtime types resolve.
    const file = fileURLToPath(new URL("../notify.ts", import.meta.url))
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
        `bun build failed (status ${res.status}):\n${res.stderr}`,
      )
    }
  })
})
