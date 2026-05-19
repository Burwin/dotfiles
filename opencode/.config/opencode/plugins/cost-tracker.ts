import type { Plugin } from "@opencode-ai/plugin"

/**
 * cost-tracker — captures every AssistantMessage opencode produces and writes
 * a row to ~/.local/state/opencode-cost.db, mirroring opencode's locally-
 * computed `cost` field alongside our own tier-aware recompute.
 *
 * Design and rationale: ../../../../docs/plans/opencode-cost-tracker/PLAN.md
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
 * THIS FILE IS A STUB. Phase 1 fills in the event handlers and DB calls;
 * see PLAN.md §6 Phase 1 for the exact behaviour and verification steps.
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
    // permissions, etc.) — fall back to the raw worktree path.
    worktreePath = worktree
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

  return {
    event: async ({ event }) => {
      if (!db) return

      const e = event as unknown as { type: string; properties?: any }
      const p = e.properties ?? {}

      try {
        switch (e.type) {
          case "message.updated": {
            const msg = p.message as any
            if (!msg?.id) return

            const tokens = msg.tokens as any ?? {}
            const rawJson = JSON.stringify(msg).slice(0, 10000)

            const rateKey = `${msg.providerID}/${msg.modelID}`
            const rate = rateTable.rates[rateKey]
            const costRecomputed = recomputeModule.recompute(rate, {
              input: tokens.input ?? 0,
              output: tokens.output ?? 0,
              reasoning: tokens.reasoning ?? 0,
              cache_read: tokens.cache?.read ?? 0,
              cache_write: tokens.cache?.write ?? 0,
            })

            await db.messages.upsert({
              message_id: msg.id,
              session_id: p.sessionID ?? "",
              worktree_path: worktreePath,
              provider_id: msg.providerID ?? "",
              model_id: msg.modelID ?? "",
              agent: p.agent ?? null,
              ts_created: msg.createdAt ?? "",
              ts_completed: msg.completedAt ?? null,
              tokens_input: tokens.input ?? 0,
              tokens_output: tokens.output ?? 0,
              tokens_reasoning: tokens.reasoning ?? 0,
              tokens_cache_read: tokens.cache?.read ?? 0,
              tokens_cache_write: tokens.cache?.write ?? 0,
              cost_opencode_fxp8: Math.round((msg.cost ?? 0) * 1e8),
              cost_recomputed_fxp8: costRecomputed,
              rate_version: rateTable.rate_version,
              finish: msg.finish ?? null,
              raw_json: rawJson,
            })
            break
          }

          case "session.idle": {
            const sessionId = p.sessionID as string
            if (!sessionId) break

            await db.sessionRollup.computeAndUpsert(sessionId, new Date().toISOString())
            break
          }

          case "session.compacted":
          case "session.created":
            break

          default:
            break
        }
      } catch (e) {
        console.warn("[cost-tracker] event handler error:", e)
      }
    },
  }
}
