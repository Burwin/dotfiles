// opencode-cost/zen-sync.ts — pulls daily per-model billed-dollar totals
// from Zen's internal `_server` server-function endpoint, parses the
// `$R[n]` slot-graph response, and writes to `zen_daily_billed`.
//
// Design and rationale: ../../../../docs/plans/opencode-cost-tracker/PLAN.md
//
// Phase ownership of this file:
//   Phase 4 (zen reconciliation, tier: sota) — implement the request
//     builder, the `;0xHEX;` chunk-prefix stripper, the static `$R[n]`
//     graph parser, and the UPSERT into zen_daily_billed.
//
// IMPORTANT: parse the response STATICALLY. Do NOT use `node:vm` to eval
// the returned IIFE. The static parser is ~50 lines and trivially
// debuggable when the serializer format changes; eval-from-network is a
// principled "no" even sandboxed.
//
// Request shape (captured 2026-05-18 from Zen dashboard's workspace
// usage page — see PLAN.md §6 Phase 4 for full headers and decoding):
//
//   POST https://opencode.ai/_server
//   Body: {"t":{"t":9,"i":0,"l":4,"a":[
//            {"t":1,"s":"<workspace_id>"},
//            {"t":0,"s":<year>},
//            {"t":0,"s":<month_0_indexed>},
//            {"t":1,"s":"<tz_offset_like_-04:00>"}
//          ],"o":0},
//          "f":31,"m":[]}
//
// Response shape (after stripping `;0xNNNNN;` chunk prefixes and parsing
// the `$R[n]` slot graph):
//
//   { usage: Array<{ date, model, totalCost (fxp8), keyId, plan }>,
//     keys:  Array<{ id, displayName, deleted }> }
//
// Fragility budget (full table in PLAN.md §7):
//   - Cookie expires       → 401 / login redirect → recapture from DevTools.
//   - x-server-id rotates  → 4xx/5xx → re-scrape from workspace HTML.
//   - f:31 function shifts → wrong-shape response → re-scrape JS bundle.
//   - $R[n] format changes → parse failure → dump raw response, bail loud.
//
// THIS FILE IS A STUB. Phase 4 fills in everything; see PLAN.md §6 Phase 4.

export type ZenUsageRow = {
  date: string                // "YYYY-MM-DD"
  model: string               // e.g. "claude-opus-4-7"
  totalCost: number           // fxp8 USD (×1e-8). Integer per Zen's serializer.
  keyId: string
  plan: string | null         // null = pay-as-you-go
}

export type ZenSyncOptions = {
  month?: string              // "YYYY-MM"; defaults to current month
  workspaceId: string
  keyId: string
  tzOffset: string            // e.g. "-04:00"
  serverId: string            // x-server-id; rotates on Zen deploys
  cookie: string              // contents of ~/.config/opencode/secrets/zen-session-cookie
}

// Phase 4 fills in:
//
//   export async function fetchZenUsage(opts): Promise<ZenUsageRow[]>
//     1. Build the request body from opts (year/month0/tz).
//     2. POST opencode.ai/_server with cookie + headers (origin, referer,
//        x-server-id, x-server-instance).
//     3. Read response as text.
//     4. Strip `;0xHEX;` chunk prefixes (regex; concatenate if multi-chunk).
//     5. Static-parse the `$R[n]` graph (custom parser, no eval).
//     6. Resolve back-references, walk to $R[0].usage, normalize.
//     7. Return usage rows.
//
//   export async function runZenSync(argv): Promise<number>
//     - load opts from ~/.config/opencode-cost/config.json
//     - load cookie from ~/.config/opencode/secrets/zen-session-cookie
//     - parse --month from argv (defaults to current)
//     - call fetchZenUsage
//     - UPSERT INTO zen_daily_billed (date, model, key_id, plan,
//                                      total_cost_fxp8, fetched_at)
//
// The static $R[n] parser lives in this file (no separate module) until
// it grows enough to warrant extraction.
