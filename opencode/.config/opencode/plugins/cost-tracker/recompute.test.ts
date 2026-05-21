// recompute.test.ts — bun:test suite for ./recompute.ts
//
// Covers every edge case documented in the source comments and in
// docs/plans/opencode-plugin-smoke/PLAN.md Step 1.

import { describe, expect, mock, test } from "bun:test"
import { recompute, type Tokens } from "./recompute.ts"
import type { Rate } from "./rate-table.ts"

function makeRate(partial: Partial<Rate> & Pick<Rate, "input" | "output">): Rate {
  return {
    providerID: "test-provider",
    modelID: "test-model",
    version: 1,
    input: partial.input,
    output: partial.output,
    cache_read: partial.cache_read ?? 0,
    cache_write: partial.cache_write ?? 0,
    tier_breakpoint: partial.tier_breakpoint,
    input_over_tier: partial.input_over_tier,
    output_over_tier: partial.output_over_tier,
  }
}

function makeTokens(partial: Partial<Tokens> & Pick<Tokens, "input" | "output">): Tokens {
  return {
    input: partial.input,
    output: partial.output,
    reasoning: partial.reasoning ?? 0,
    cache_read: partial.cache_read ?? 0,
    cache_write: partial.cache_write ?? 0,
  }
}

describe("recompute", () => {
  test("happy path, no breakpoint", () => {
    const rate = makeRate({ input: 1, output: 2, cache_read: 0.5, cache_write: 0.25 })
    const tokens = makeTokens({ input: 10, output: 5, reasoning: 3, cache_read: 2, cache_write: 1 })
    // billableInput = 12
    // cost = 12*1 + 5*2 + 3*2 + 2*0.5 + 1*0.25 = 29.25
    expect(recompute(rate, tokens)).toBe(2925000000)
  })

  test("missing rate warns once and returns 0", () => {
    const warnSpy = mock(() => {})
    const originalWarn = console.warn
    console.warn = warnSpy

    try {
      const tokens = makeTokens({ input: 1, output: 1 })
      expect(recompute(undefined, tokens)).toBe(0)
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls[0][0]).toBe("[cost-tracker] no rate found for model, using 0 cost")

      // Second call should not warn again (module-scoped latch)
      expect(recompute(undefined, tokens)).toBe(0)
      expect(warnSpy).toHaveBeenCalledTimes(1)
    } finally {
      console.warn = originalWarn
    }
  })

  test("tier breakpoint: billableInput < breakpoint → over = 0", () => {
    const rate = makeRate({ input: 1, output: 2, cache_read: 0.5, tier_breakpoint: 20, input_over_tier: 0.5 })
    const tokens = makeTokens({ input: 10, output: 5, cache_read: 5 }) // billableInput = 15
    // under = 15, over = 0
    // cost = 15*1 + 5*2 + 5*0.5 = 15 + 10 + 2.5 = 27.5
    expect(recompute(rate, tokens)).toBe(2750000000)
  })

  test("tier breakpoint: billableInput > breakpoint → mixed", () => {
    const rate = makeRate({ input: 1, output: 2, cache_read: 0.5, tier_breakpoint: 10, input_over_tier: 0.5 })
    const tokens = makeTokens({ input: 10, output: 5, reasoning: 3, cache_read: 2, cache_write: 1 })
    // billableInput = 12, over = 2, under = 10
    // cost = 10*1 + 2*0.5 + 5*2 + 3*2 + 2*0.5 + 1*0 = 10 + 1 + 10 + 6 + 1 + 0 = 28
    expect(recompute(rate, tokens)).toBe(2800000000)
  })

  test("tier breakpoint: billableInput === breakpoint → over = 0", () => {
    const rate = makeRate({ input: 1, output: 2, cache_read: 0.5, tier_breakpoint: 12, input_over_tier: 0.5 })
    const tokens = makeTokens({ input: 10, output: 5, cache_read: 2 }) // billableInput = 12
    // over = 0, under = 12
    // cost = 12*1 + 5*2 + 2*0.5 = 12 + 10 + 1 = 23
    expect(recompute(rate, tokens)).toBe(2300000000)
  })

  test("input_over_tier absent falls back to rate.input", () => {
    const rate = makeRate({ input: 1, output: 2, cache_read: 0.5, tier_breakpoint: 10 })
    // input_over_tier is undefined → should use rate.input (1) for the over portion too
    const tokens = makeTokens({ input: 10, output: 5, reasoning: 3, cache_read: 2 })
    // billableInput = 12, over = 2, under = 10
    // cost = 10*1 + 2*1 + 5*2 + 3*2 + 2*0.5 = 10 + 2 + 10 + 6 + 1 = 29
    expect(recompute(rate, tokens)).toBe(2900000000)
  })

  test("output_over_tier is read but unused (contract pin)", () => {
    const rate = makeRate({ input: 1, output: 2, output_over_tier: 999, cache_read: 0 })
    const tokens = makeTokens({ input: 0, output: 5, reasoning: 3 })
    // If output_over_tier were used, cost would be huge; it should still use rate.output = 2
    // cost = (5 + 3) * 2 = 16
    expect(recompute(rate, tokens)).toBe(1600000000)
  })

  test("cache_write rate absent contributes 0", () => {
    const rate = makeRate({ input: 1, output: 0, cache_read: 0 })
    // cache_write is undefined in the partial, so it defaults to 0 in makeRate
    const tokens = makeTokens({ input: 0, output: 0, cache_write: 100 })
    // cost = 100 * 0 = 0
    expect(recompute(rate, tokens)).toBe(0)
  })

  test("reasoning bills as output", () => {
    const rate = makeRate({ input: 0, output: 3, cache_read: 0 })
    const tokens = makeTokens({ input: 0, output: 0, reasoning: 4 })
    // cost = 4 * 3 = 12
    expect(recompute(rate, tokens)).toBe(1200000000)
  })

  test("floating-point rounding uses Math.round, not truncation", () => {
    const rate = makeRate({ input: 1e-9, output: 0, cache_read: 0 })
    const tokens = makeTokens({ input: 5, output: 0 })
    // cost = 5e-9; cost * 1e8 = 0.5; Math.round(0.5) = 1, truncation would give 0
    expect(recompute(rate, tokens)).toBe(1)
  })
})
