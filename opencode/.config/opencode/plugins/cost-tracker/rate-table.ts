// cost-tracker/rate-table.ts — fetches and caches the opencode rate
// table (`GET /config/providers`) so the recompute step can use the same
// rates the TUI is currently using.
//
// Design and rationale: ../../../../../docs/archive/opencode/PLAN-cost-tracker.md
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
  let rawResult: any

  try {
    if (typeof (client as any).config?.providers === "function") {
      rawResult = await (client as any).config.providers()
    } else {
      const port = process.env.OPENCODE_PORT ?? "3310"
      const res = await (client as any).fetch?.(`http://127.0.0.1:${port}/config/providers`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      rawResult = await res.json()
    }
  } catch (e) {
    console.warn("[cost-tracker] failed to fetch rates:", e)
    return { rate_version: "fetch-failed", rates: {} }
  }

  // The HeyAPI-generated SDK client returns `{ data, request, response, error }`
  // — unwrap to the body. Plain-fetch path already returns the body directly,
  // so accept either shape. Then dig into `.providers` per the SDK's
  // ConfigProvidersResponses[200] = { providers: Provider[], default: {...} }.
  // Pre-fix the code read `.providers` off the envelope itself, which was
  // undefined → fell back to the envelope object → `for...of` threw
  // "TypeError: {} is not iterable" → silently dropped to fetch-failed via
  // the outer .catch in cost-tracker.ts. Symptom: provider_rates stayed
  // empty even though plugin load looked fine in the opencode log.
  const body = rawResult?.data ?? rawResult
  const providersList = Array.isArray(body?.providers)
    ? body.providers
    : Array.isArray(body)
      ? body
      : []

  const normalized: Record<string, Rate> = {}

  for (const provider of providersList) {
    const providerId = provider.id ?? provider.name ?? provider.provider
    // Provider.models is `{ [modelId]: Model }` in @opencode-ai/sdk@1.14
    // (was a flat array in an earlier shape). Object.values reads the
    // current shape; the Array.isArray branch covers the old shape so
    // a downgrade doesn't crash. Same envelope-vs-body story as
    // providersList above — `for...of` on a plain object throws
    // "TypeError: {} is not iterable".
    const modelsRaw = provider.models ?? {}
    const modelsList: Array<any> = Array.isArray(modelsRaw)
      ? modelsRaw
      : Object.values(modelsRaw)
    for (const model of modelsList) {
      const modelId = model.id ?? model.name ?? model.model
      if (!providerId || !modelId) continue

      // Current SDK: Model.cost.{input,output,cache.{read,write}}
      //   + optional experimentalOver200K subtree for the >200K tier.
      // Older shape (kept as a fallback): model.prices.* / model.price.*.
      const c: any = model.cost ?? {}
      const over: any = c.experimentalOver200K
      const input =
        c.input ?? model.prices?.input ?? model.price?.input ?? 0
      const output =
        c.output ?? model.prices?.output ?? model.price?.output ?? 0
      const cacheRead =
        c.cache?.read ??
        model.prices?.cache_read ??
        model.price?.cache_read ??
        0
      const cacheWrite =
        c.cache?.write ?? model.prices?.cache_write ?? model.price?.cache_write

      normalized[`${providerId}/${modelId}`] = {
        input,
        output,
        cache_read: cacheRead,
        cache_write: cacheWrite,
        // Presence of an over-200K rate block is the only signal the
        // SDK gives us today that a tier crossing exists at all.
        // recompute.ts uses tier_breakpoint as the boundary; if it's
        // undefined the tier-split branch is a no-op.
        tier_breakpoint: over ? 200000 : model.tier_breakpoint,
        input_over_tier:
          over?.input ?? model.prices?.input_over_tier,
        output_over_tier:
          over?.output ?? model.prices?.output_over_tier,
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
  if (!db?.providerRates?.upsert) return
  try {
    await db.providerRates.upsert(table.rate_version, JSON.stringify(table.rates))
  } catch (e) {
    console.warn("[cost-tracker] failed to persist rate snapshot:", e)
  }
}
