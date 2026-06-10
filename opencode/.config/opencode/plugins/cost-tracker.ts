import type { Plugin } from "@opencode-ai/plugin"

/**
 * cost-tracker — captures every AssistantMessage opencode produces and writes
 * a row to ~/.local/state/opencode-cost.db, mirroring opencode's locally-
 * computed `cost` field alongside our own tier-aware recompute.
 *
 * Design and rationale: ../../../../docs/archive/opencode/PLAN-cost-tracker.md
 *
 * Phase ownership of this file:
 *   Phase 1 (capture, tier: cheap) — wires `message.updated` /
 *     `session.idle` / `session.compacted` / `session.created` to
 *     `./cost-tracker/db.ts` UPSERTs. No math; `cost_recomputed_fxp8`
 *     copies `cost_opencode_fxp8` in this phase.
 *   Phase 2 (recompute, tier: mid) — fetches /config/providers via the
 *     injected `client` SDK instance, persists the rate snapshot, and
 *     plugs in `./cost-tracker/recompute.ts` for tier-aware math.
 *
 * Style: matches notify.ts in this directory (file layout: subdir hides
 * companion .ts files from the plugin loader's non-recursive glob) and
 * the bamboo `toggl-time.ts` plugin in defensive event handling (cast-
 * once, switch-with-default, best-effort SQL).
 *
 * Runtime: Bun. `bun:sqlite` is dynamic-imported inside a try/catch in
 * ./cost-tracker/db.ts so a non-Bun host degrades to silent no-op rather
 * than crashing the plugin runtime — same pattern as toggl-time.ts.
 *
 * Robustness: every effect is try/caught at the call site. The plugin is
 * best-effort and must never bring opencode down.
 *
 * Event payload shape (confirmed against @opencode-ai/sdk@1.14.28
 * dist/gen/types.gen.d.ts):
 *
 *   EventMessageUpdated.properties = { info: Message }
 *     where Message = UserMessage | AssistantMessage. We only care about
 *     the assistant variant (cost/tokens). User messages have no cost
 *     fields, so we filter by `role === "assistant"`.
 *
 *   AssistantMessage carries: id, sessionID, role: "assistant",
 *     time.{created, completed?} (epoch ms NUMBERS — must be converted
 *     to ISO strings before INSERT), modelID, providerID, mode, cost,
 *     tokens.{input, output, reasoning, cache.{read, write}}, finish?.
 *     No `createdAt`/`completedAt`/`agent` top-level keys — the older
 *     SDK shape had those, hence the per-task PLAN's "payload shape
 *     drift" diagnosis.
 *
 *   EventSessionIdle.properties.sessionID → the rollup trigger.
 */

export const CostTrackerPlugin: Plugin = async ({ worktree, client }) => {
  let db: any = null
  let worktreePath = ""
  let rateTable: any = { rate_version: "", rates: {} }

  try {
    const fs = await import("fs")
    worktreePath = fs.realpathSync(worktree)
  } catch {
    // realpathSync is synchronous and throws on failure (no path,
    // permissions, etc.) — fall back to the raw worktree path. Defensive
    // empty-string default if `worktree` itself is somehow falsy: the
    // schema declares `worktree_path TEXT NOT NULL`, so a NULL here would
    // trigger a constraint violation that would be swallowed by the outer
    // try/catch in the event handler, leaving messages empty with no
    // diagnostic. Better to write an empty string and let queries report
    // the row as unmapped than to silently drop it.
    worktreePath = worktree ?? ""
  }

  try {
    const dbModule = await import("./cost-tracker/db.ts")
    db = await dbModule.openDb()
  } catch (e) {
    console.warn("[cost-tracker] failed to initialize DB:", e)
  }

  // CRITICAL: do NOT `await fetchRates` here. The /config/providers
  // endpoint is served by the same opencode process whose main thread
  // is currently loading us — awaiting the response deadlocks startup
  // for ~15+ seconds, after which the TUI's setRawMode fails with
  // errno 5 (EIO) and opencode exits before reaching the prompt. See
  // PLAN.md §6 Phase 2 + the bug note in the Progress block.
  //
  // Fire-and-forget instead: rate table fills in once the server is
  // listening. Messages arriving before rates land record
  // cost_recomputed_fxp8 = 0 (recompute returns 0 for missing rate);
  // cost_opencode_fxp8 is unaffected because it comes from the message
  // payload. Once rates land, subsequent messages compute correctly.
  const recomputeModule = await import("./cost-tracker/recompute.ts")
  const rateModule = await import("./cost-tracker/rate-table.ts")
  rateModule
    .fetchRates(client)
    .then((table) => {
      rateTable = table
      if (db) {
        rateModule
          .persistSnapshot(db, table)
          .catch((e) =>
            console.warn("[cost-tracker] failed to persist rate snapshot:", e),
          )
      }
      console.log(
        "[cost-tracker] loaded",
        Object.keys(table.rates).length,
        "rates",
      )
    })
    .catch((e) =>
      console.warn("[cost-tracker] failed to load rate table:", e),
    )

  // Latch so the missing-DB warning fires once per plugin lifetime (every
  // single event would otherwise spam the log). Mirrors the warn-latch
  // pattern in ./cost-tracker/recompute.ts for missing rates.
  let warnedNoDb = false

  // Convert opencode's epoch-ms numeric timestamps (msg.time.created /
  // msg.time.completed) to the ISO 8601 strings the messages.ts_created /
  // ts_completed columns expect. Returns null when the input isn't a
  // finite number; the caller decides whether null is acceptable for
  // each column.
  const epochMsToIso = (n: unknown): string | null => {
    if (typeof n !== "number" || !Number.isFinite(n)) return null
    return new Date(n).toISOString()
  }

  return {
    event: async ({ event }) => {
      if (!db) {
        if (!warnedNoDb) {
          console.warn("[cost-tracker] DB unavailable; dropping all events for this session")
          warnedNoDb = true
        }
        return
      }

      const e = event as unknown as { type: string; properties?: any }
      const p = e.properties ?? {}

      try {
        switch (e.type) {
          case "message.updated": {
            // Payload shape from @opencode-ai/sdk@1.14.28:
            //   EventMessageUpdated.properties = { info: Message }
            // The pre-fix code read `p.message`, which was undefined on
            // every event — that's the silent capture bug fixed in
            // Commit 1 (docs/plans/opencode-cost-pertask-tmux-status/
            // PLAN.md §9 Commit 1).
            const msg = p.info as any
            if (!msg?.id) {
              console.warn(
                "[cost-tracker] message.updated missing properties.info.id; dropping",
                { hasInfo: !!p.info, propsKeys: Object.keys(p) },
              )
              return
            }

            // Skip user messages: they carry no cost/tokens and would
            // write zero-cost rows that pollute rollups and reconcile
            // queries. Only AssistantMessage has the fields we capture.
            if (msg.role !== "assistant") return

            const tokens = msg.tokens as any ?? {}
            const rawJson = JSON.stringify(msg).slice(0, 10000)

            // Cache write TTL split. opencode's AssistantMessage carries
            // `tokens.cache.write` as either:
            //   (a) a flat number (legacy total — sum semantics), or
            //   (b) an object { "5m": N, "1h": M } when the model
            //       distinguishes the two cache tiers.
            // We persist both the per-tier breakdown (5m/1h columns,
            // nullable) AND the sum (existing tokens_cache_write column)
            // so the existing rollups don't need a schema-aware rewrite.
            // §4.3 of docs/plans/opencode-cost-pertask-tmux-status/PLAN.md
            // pins this contract.
            const cacheWriteRaw = tokens.cache?.write
            let cacheWrite5m: number | null = null
            let cacheWrite1h: number | null = null
            let cacheWriteSum = 0
            if (typeof cacheWriteRaw === "number") {
              cacheWriteSum = cacheWriteRaw
            } else if (cacheWriteRaw && typeof cacheWriteRaw === "object") {
              const w = cacheWriteRaw as Record<string, unknown>
              const fiveM = w["5m"] ?? w.fiveMinute ?? w.cache_write_5m ?? null
              const oneH = w["1h"] ?? w.oneHour ?? w.cache_write_1h ?? null
              cacheWrite5m = typeof fiveM === "number" ? fiveM : null
              cacheWrite1h = typeof oneH === "number" ? oneH : null
              cacheWriteSum = (cacheWrite5m ?? 0) + (cacheWrite1h ?? 0)
            }

            const rateKey = `${msg.providerID}/${msg.modelID}`
            const rate = rateTable.rates[rateKey]
            const costRecomputed = recomputeModule.recompute(rate, {
              input: tokens.input ?? 0,
              output: tokens.output ?? 0,
              reasoning: tokens.reasoning ?? 0,
              cache_read: tokens.cache?.read ?? 0,
              cache_write: cacheWriteSum,
            })

            // ts_created is NOT NULL in the schema; fall back to "now"
            // if the payload somehow lacks a timestamp so we still
            // capture the row rather than triggering a constraint
            // violation that the outer try/catch would swallow.
            const tsCreated =
              epochMsToIso(msg.time?.created) ?? new Date().toISOString()
            const tsCompleted = epochMsToIso(msg.time?.completed)

            await db.messages.upsert({
              message_id: msg.id,
              // sessionID lives ON the AssistantMessage itself in the
              // current SDK; `properties.sessionID` does not exist on
              // EventMessageUpdated. Was reading the wrong location.
              session_id: msg.sessionID ?? "",
              worktree_path: worktreePath,
              provider_id: msg.providerID ?? "",
              model_id: msg.modelID ?? "",
              // AssistantMessage.mode is the canonical agent identifier
              // in the v1.14 SDK; accept `agent` as a defensive
              // fallback since runtime payloads have been observed to
              // carry both keys.
              agent: msg.mode ?? msg.agent ?? null,
              ts_created: tsCreated,
              ts_completed: tsCompleted,
              tokens_input: tokens.input ?? 0,
              tokens_output: tokens.output ?? 0,
              tokens_reasoning: tokens.reasoning ?? 0,
              tokens_cache_read: tokens.cache?.read ?? 0,
              tokens_cache_write: cacheWriteSum,
              tokens_cache_write_5m: cacheWrite5m,
              tokens_cache_write_1h: cacheWrite1h,
              cost_opencode_fxp8: Math.round((msg.cost ?? 0) * 1e8),
              cost_recomputed_fxp8: costRecomputed,
              rate_version: rateTable.rate_version,
              finish: msg.finish ?? null,
              raw_json: rawJson,
            })
            break
          }

          case "session.idle": {
            // EventSessionIdle.properties.sessionID — this path was
            // correct pre-fix; only fails to write rows because the
            // messages table had no rows to roll up (the upstream
            // capture-bug symptom). After Commit 1, this populates
            // session_rollup on every idle.
            const sessionId = p.sessionID as string
            if (!sessionId) {
              console.warn("[cost-tracker] session.idle missing sessionID; dropping")
              break
            }

            await db.sessionRollup.computeAndUpsert(sessionId, new Date().toISOString())
            break
          }

          case "session.compacted":
          case "session.created":
            break

          default:
            break
        }
      } catch (err) {
        // Renamed catch binding from `e` to `err` so it doesn't shadow
        // the outer `e` (the cast event) — the prior shadowing made
        // diagnostic messages reference the wrong identifier when
        // reading the source.
        console.warn("[cost-tracker] event handler error:", err)
      }
    },
  }
}
