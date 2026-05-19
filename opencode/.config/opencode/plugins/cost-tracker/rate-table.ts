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
export async function fetchRates(client: any): Promise<RateTable> {
  let providersJson: any

  try {
    if (typeof (client as any).config?.providers === "function") {
      providersJson = await (client as any).config.providers()
    } else {
      const port = process.env.OPENCODE_PORT ?? "3310"
      const res = await (client as any).fetch?.(`http://127.0.0.1:${port}/config/providers`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      providersJson = await res.json()
    }
  } catch (e) {
    console.warn("[cost-tracker] failed to fetch rates:", e)
    return { rate_version: "fetch-failed", rates: {} }
  }

  const normalized: Record<string, Rate> = {}

  const providers = providersJson.providers ?? providersJson ?? []
  for (const provider of providers) {
    const providerId = provider.id ?? provider.name ?? provider.provider
    const models = provider.models ?? []
    for (const model of models) {
      const modelId = model.id ?? model.name ?? model.model
      if (!providerId || !modelId) continue

      normalized[`${providerId}/${modelId}`] = {
        input: model.prices?.input ?? model.price?.input ?? 0,
        output: model.prices?.output ?? model.price?.output ?? 0,
        cache_read: model.prices?.cache_read ?? model.price?.cache_read ?? 0,
        cache_write: model.prices?.cache_write ?? model.price?.cache_write,
        tier_breakpoint: model.tier_breakpoint ?? model.experimentalOver200K ? 200000 : undefined,
        input_over_tier: model.prices?.input_over_tier,
        output_over_tier: model.prices?.output_over_tier,
      }
    }
  }

  const normalizedJson = JSON.stringify(normalized, Object.keys(normalized).sort())
  const rateVersion = await sha256(normalizedJson)

  return { rate_version: rateVersion, rates: normalized }
}

async function sha256(str: string): Promise<string> {
  const buf = new TextEncoder().encode(str)
  const hash = await crypto.subtle.digest("SHA-256", buf)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
}

export async function persistSnapshot(db: any, table: RateTable): Promise<void> {
  if (!db) return
  try {
    db.query(`
      INSERT OR IGNORE INTO provider_rates (rate_version, fetched_at, payload_json)
      VALUES (?, ?, ?)
    `).run(table.rate_version, new Date().toISOString(), JSON.stringify(table.rates))
  } catch (e) {
    console.warn("[cost-tracker] failed to persist rate snapshot:", e)
  }
}
