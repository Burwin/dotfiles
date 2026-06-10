// cost-tracker/recompute.ts — pure cost math for the opencode
// cost-tracker plugin (../cost-tracker.ts).
//
// Design and rationale: ../../../../../docs/archive/opencode/PLAN-cost-tracker.md
//
// Phase ownership of this file:
//   Phase 2 (recompute, tier: mid) — implement `recompute(rate, tokens)`
//     per the algorithm in PLAN.md §6 Phase 2. Pure function: no I/O,
//     no env reads, no DB access. Returns fxp8 USD (integer).
//
// Why pure: this is the one piece that must be obviously correct, so it
// must be straightforward to unit test (mirroring the toggl-time.lib.ts
// /  notify/lib.ts factoring pattern). Tests live alongside in
// ./recompute.test.ts (Phase 2 adds them).
//
// Algorithm (from PLAN.md §6 Phase 2):
//
//   billable_input = tokens.input + tokens.cache_read
//   over  = max(0, billable_input - rate.tier_breakpoint)   // 0 if no breakpoint
//   under = billable_input - over
//
//   cost  = under * rate.input
//   cost += over  * rate.input_over_tier
//   cost += tokens.output     * rate.output
//   cost += tokens.reasoning  * rate.output        // billed as output
//   cost += tokens.cache_read * rate.cache_read
//   cost += tokens.cache_write * (rate.cache_write ?? 0)
//   return round_to_integer(cost * 1e8)            // fxp8
//
// Edge cases Phase 2 must handle:
//   - Missing rate for a model (return 0, log once via a warn-latch).
//   - Output rate present but `output_over_tier` absent: use the same
//     rate either side of the breakpoint.
//   - tokens.reasoning sometimes 0; that's fine, still bills as output.
//   - Floating-point drift: do the multiplication at full float precision
//     then `Math.round()` to fxp8 integer at the end. Adding rates
//     pre-rounded per token loses precision on cheap models.
//
// THIS FILE IS A STUB. Phase 2 fills in `recompute`; see PLAN.md §6 Phase 2.

import type { Rate } from "./rate-table.ts"

export type Tokens = {
  input: number
  output: number
  reasoning: number
  cache_read: number
  cache_write: number
}

let warnedMissingRate = false

export function recompute(rate: Rate | undefined, tokens: Tokens): number {
  if (!rate) {
    if (!warnedMissingRate) {
      console.warn("[cost-tracker] no rate found for model, using 0 cost")
      warnedMissingRate = true
    }
    return 0
  }

  const billableInput = tokens.input + tokens.cache_read
  const breakpoint = rate.tier_breakpoint ?? 0
  const over = Math.max(0, billableInput - breakpoint)
  const under = billableInput - over

  const inputOverRate = rate.input_over_tier ?? rate.input
  const outputOverRate = rate.output_over_tier ?? rate.output

  let cost = 0

  cost += under * rate.input
  cost += over * inputOverRate
  cost += tokens.output * rate.output
  cost += tokens.reasoning * rate.output
  cost += tokens.cache_read * rate.cache_read
  cost += tokens.cache_write * (rate.cache_write ?? 0)

  return Math.round(cost * 1e8)
}
