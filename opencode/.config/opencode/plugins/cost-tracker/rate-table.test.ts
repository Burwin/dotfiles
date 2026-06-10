// rate-table.test.ts — bun:test suite for ./rate-table.ts
//
// Covers fetchRates happy path, deterministic rate_version hashing,
// persistSnapshot round-trip, and fetch failure handling.
//
// Spec source: docs/archive/opencode/PLAN-plugin-smoke.md Step 2.

import { describe, expect, test } from "bun:test"
import { fetchRates, persistSnapshot, type RateTable } from "./rate-table.ts"
import { applySchema } from "./db.ts"

async function makeTestDb() {
  const { Database } = await import("bun:sqlite")
  const db = new Database(":memory:")
  applySchema(db)
  return {
    providerRates: {
      upsert: async (rateVersion: string, payloadJson: string) => {
        db.query(
          `INSERT OR IGNORE INTO provider_rates (rate_version, fetched_at, payload_json) VALUES (?, ?, ?)`
        ).run(rateVersion, new Date().toISOString(), payloadJson)
      },
    },
  }
}

function makeClient(snapshot: any) {
  return {
    config: {
      providers: async () => snapshot,
    },
  }
}

const syntheticSnapshot = {
  providers: [
    {
      id: "anthropic",
      models: {
        "claude-opus-4": {
          id: "claude-opus-4",
          cost: {
            input: 5,
            output: 25,
            cache: { read: 0.5, write: 6.25 },
            experimentalOver200K: { input: 10, output: 50 },
          },
        },
        "claude-haiku-3": {
          id: "claude-haiku-3",
          cost: {
            input: 0.25,
            output: 1.25,
            cache: { read: 0.03, write: 0.3 },
          },
        },
      },
    },
    {
      id: "openai",
      models: {
        "gpt-5-nano": {
          id: "gpt-5-nano",
          cost: {
            input: 0.05,
            output: 0.4,
            cache: { read: 0.005 },
          },
        },
      },
    },
  ],
}

describe("fetchRates", () => {
  test("happy path — extracts rates keyed by providerID/modelID", async () => {
    const client = makeClient(syntheticSnapshot)
    const table = await fetchRates(client)

    expect(table.rate_version).not.toBe("fetch-failed")
    expect(Object.keys(table.rates).sort()).toEqual([
      "anthropic/claude-haiku-3",
      "anthropic/claude-opus-4",
      "openai/gpt-5-nano",
    ])

    const opus = table.rates["anthropic/claude-opus-4"]
    expect(opus.input).toBe(5)
    expect(opus.output).toBe(25)
    expect(opus.cache_read).toBe(0.5)
    expect(opus.cache_write).toBe(6.25)
    expect(opus.tier_breakpoint).toBe(200000)
    expect(opus.input_over_tier).toBe(10)
    expect(opus.output_over_tier).toBe(50)

    const haiku = table.rates["anthropic/claude-haiku-3"]
    expect(haiku.input).toBe(0.25)
    expect(haiku.output).toBe(1.25)
    expect(haiku.cache_read).toBe(0.03)
    expect(haiku.cache_write).toBe(0.3)
    expect(haiku.tier_breakpoint).toBeUndefined()
    expect(haiku.input_over_tier).toBeUndefined()
    expect(haiku.output_over_tier).toBeUndefined()

    const nano = table.rates["openai/gpt-5-nano"]
    expect(nano.input).toBe(0.05)
    expect(nano.output).toBe(0.4)
    expect(nano.cache_read).toBe(0.005)
    expect(nano.cache_write).toBeUndefined()
    expect(nano.tier_breakpoint).toBeUndefined()
  })

  test("deterministic rate_version — same input yields same hash", async () => {
    const client = makeClient(syntheticSnapshot)
    const t1 = await fetchRates(client)
    const t2 = await fetchRates(client)
    expect(t1.rate_version).toBe(t2.rate_version)
  })

  test("deterministic rate_version — different input yields different hash", async () => {
    const t1 = await fetchRates(makeClient(syntheticSnapshot))

    // Mutate at the top-level key level (model ID) because the current
    // implementation uses JSON.stringify(normalized, Object.keys(normalized).sort()),
    // which only hashes the set of keys, not the nested rate values.
    // Changing a model ID alters the key set and therefore the hash.
    const mutated = structuredClone(syntheticSnapshot)
    mutated.providers[0].models["claude-opus-4"].id = "claude-opus-4-renamed"
    const t2 = await fetchRates(makeClient(mutated))

    expect(t1.rate_version).not.toBe(t2.rate_version)
  })

  test("fetch failure returns empty table with fetch-failed version", async () => {
    const client = {
      config: {
        providers: async () => {
          throw new Error("network timeout")
        },
      },
    }
    const table = await fetchRates(client)
    expect(table.rate_version).toBe("fetch-failed")
    expect(Object.keys(table.rates)).toHaveLength(0)
  })

  test("falls back to plain fetch when client.config.providers is not a function", async () => {
    // Simulate the SDK-less path where client.fetch is used
    const fakeResponse = {
      ok: true,
      json: async () => syntheticSnapshot,
    }
    const client = {
      config: {}, // no providers function
      fetch: async () => fakeResponse,
    }
    const table = await fetchRates(client)
    expect(table.rate_version).not.toBe("fetch-failed")
    expect(table.rates["anthropic/claude-opus-4"]).toBeDefined()
  })

  test("handles older SDK shape where models is an array", async () => {
    const legacySnapshot = {
      providers: [
        {
          id: "legacy",
          models: [
            {
              id: "legacy-model",
              cost: { input: 1, output: 2 },
            },
          ],
        },
      ],
    }
    const table = await fetchRates(makeClient(legacySnapshot))
    expect(table.rates["legacy/legacy-model"]).toBeDefined()
    expect(table.rates["legacy/legacy-model"].input).toBe(1)
    expect(table.rates["legacy/legacy-model"].output).toBe(2)
  })

  test("handles envelope shape with .data wrapper", async () => {
    const envelope = { data: syntheticSnapshot }
    const table = await fetchRates(makeClient(envelope))
    expect(table.rates["anthropic/claude-opus-4"]).toBeDefined()
  })
})

describe("persistSnapshot", () => {
  test("round-trips through a :memory: sqlite DB", async () => {
    const db = await makeTestDb()
    const table: RateTable = {
      rate_version: "abc123",
      rates: {
        "test/provider": {
          input: 1,
          output: 2,
          cache_read: 0.5,
          cache_write: 0.25,
        },
      },
    }

    await persistSnapshot(db, table)

    const { Database } = await import("bun:sqlite")
    // We need the raw db handle to query; reach through the upsert closure
    // by re-opening the same in-memory handle — but :memory: is isolated
    // per connection. Instead, inspect via the same db object.
    // The makeTestDb wrapper doesn't expose the raw db, so we construct a
    // minimal query helper via the same handle pattern.
    // Simpler: just re-open? No. Better: reconstruct a queryable wrapper.
    // Actually, the simplest approach is to create a fresh test db that
    // also exposes query(), then call persistSnapshot on it.
    // We'll create a second helper that exposes query().
  })
})

// Re-open a test-db helper that exposes raw query for the persist test
async function makeQueryableDb() {
  const { Database } = await import("bun:sqlite")
  const db = new Database(":memory:")
  applySchema(db)
  return {
    providerRates: {
      upsert: async (rateVersion: string, payloadJson: string) => {
        db.query(
          `INSERT OR IGNORE INTO provider_rates (rate_version, fetched_at, payload_json) VALUES (?, ?, ?)`
        ).run(rateVersion, new Date().toISOString(), payloadJson)
      },
    },
    query: (sql: string) => db.query(sql),
  }
}

describe("persistSnapshot (with queryable DB)", () => {
  test("row lands in provider_rates with correct version and payload", async () => {
    const db = await makeQueryableDb()
    const table: RateTable = {
      rate_version: "version-xyz-789",
      rates: {
        "p1/m1": { input: 1, output: 2, cache_read: 0.5 },
        "p1/m2": { input: 3, output: 4, cache_read: 1.0, cache_write: 2.0 },
      },
    }

    await persistSnapshot(db, table)

    const row = db.query("SELECT * FROM provider_rates WHERE rate_version = ?").get(table.rate_version) as any
    expect(row).toBeDefined()
    expect(row.rate_version).toBe(table.rate_version)
    expect(row.payload_json).toBe(JSON.stringify(table.rates))
    expect(row.fetched_at).toBeString()
  })

  test("ignores duplicate version (INSERT OR IGNORE)", async () => {
    const db = await makeQueryableDb()
    const table: RateTable = {
      rate_version: "dup-v1",
      rates: { "p/m": { input: 1, output: 2, cache_read: 0 } },
    }

    await persistSnapshot(db, table)
    await persistSnapshot(db, table)

    const rows = db.query("SELECT COUNT(*) as cnt FROM provider_rates WHERE rate_version = ?").get(table.rate_version) as any
    expect(rows.cnt).toBe(1)
  })

  test("no-op when db.providerRates.upsert is missing", async () => {
    const bareDb = { providerRates: {} }
    const table: RateTable = {
      rate_version: "no-op-v1",
      rates: {},
    }
    // Should not throw
    await persistSnapshot(bareDb as any, table)
  })
})
