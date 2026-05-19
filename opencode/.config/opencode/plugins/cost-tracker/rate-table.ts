// cost-tracker/rate-table.ts — fetches and caches the opencode rate
// table (`GET /config/providers`) so the recompute step can use the same
// rates the TUI is currently using.
//
// Design and rationale: ../../../../../docs/plans/opencode-cost-tracker/PLAN.md
//
// Phase ownership of this file:
//   Phase 2 (recompute, tier: mid) — implement `fetchRates(client)` and
//     `persistSnapshot(db, payload)`. The rate version is a sha256 of the
//     normalized payload (JSON.stringify after key-sorting); collisions
//     mean the rates haven't changed and we don't write a duplicate row.
//
// Why this exists: opencode's `models.json` is opencode's *primary*
// pricing source; using the same table for our recompute means any delta
// between cost_opencode_fxp8 and cost_recomputed_fxp8 is about math
// correctness (tier handling, child aggregation, small_model attribution)
// rather than rate drift. When opencode upgrades and `models.json`
// changes, we capture a new snapshot automatically.
//
// THIS FILE IS A STUB. Phase 2 fills in the fetcher + persister; see
// PLAN.md §6 Phase 2.

export type Rate = {
  input: number              // $ per token (raw, not fxp8)
  output: number
  cache_read: number
  cache_write?: number
  tier_breakpoint?: number   // token threshold for over-tier pricing
  input_over_tier?: number   // $ per token above the breakpoint
  output_over_tier?: number
}

export type RateTable = {
  rate_version: string                       // sha256 of normalized payload
  rates: Record<string, Rate>                // keyed by `${providerID}/${modelID}`
}

// Phase 2 fills in:
//
//   export async function fetchRates(client: PluginClient): Promise<RateTable>
//     - Call `client.config.providers()` (or HTTP fallback via `client.fetch`)
//     - Normalize: sort providers and models, project to the Rate shape.
//     - sha256 the normalized JSON for `rate_version`.
//
//   export async function persistSnapshot(db, table): Promise<void>
//     - INSERT OR IGNORE INTO provider_rates(rate_version, fetched_at, payload_json)
//     - No-op when rate_version already exists.
