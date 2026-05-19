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
  // Phase 1 will:
  //   - resolve `worktree → canonicalWorktree` via fs.realpath (best-effort)
  //   - open the DB via ./cost-tracker/db.ts (dynamic bun:sqlite import)
  //   - prepare INSERT statements for `messages` + `session_rollup`
  // Phase 2 will additionally:
  //   - call `client.config.providers()` (or the equivalent) once at startup
  //   - persist the snapshot to `provider_rates`
  //   - construct a recompute fn from ./cost-tracker/recompute.ts
  //
  // `worktree` and `client` referenced here so the typechecker treats them
  // as used while the stub still has no body.
  void worktree
  void client

  return {
    event: async ({ event }) => {
      // Phase 1 dispatch (sketch — actual implementation lands in Phase 1):
      //
      //   const e = event as unknown as { type: string; properties?: any }
      //   const p = e.properties ?? {}
      //   switch (e.type) {
      //     case "message.updated":
      //       await upsertMessage(p) // db.ts
      //       break
      //     case "session.idle":
      //       await upsertRollup(p.sessionID) // db.ts aggregate query
      //       break
      //     case "session.compacted":
      //     case "session.created":
      //       // No-op in Phase 1; revisit in Phase 2 for child-session
      //       // attribution.
      //       break
      //     default:
      //       // Forward-compat: silently no-op. Re-classify when opencode
      //       // adds a new event type that affects cost accounting.
      //       break
      //   }
      void event
    },
  }
}
