// opencode-cost/reconcile.ts — `dump reconciliation` subcommand for the
// opencode-cost CLI (../bin/opencode-cost). Joins our per-session
// recompute against Zen's daily per-model billed totals, surfacing the
// drift in three columns.
//
// Design and rationale: ../../../../docs/plans/opencode-cost-tracker/PLAN.md
//
// Phase ownership of this file:
//   Phase 4 (zen reconciliation, tier: sota) — implement the daily-join
//     SQL and the formatter.
//
// Output columns:
//   date | model | recomputed_$ | tui_$ | zen_billed_$ | recompute_delta_$ | tui_delta_$
//
//   recompute_delta_$ = recomputed_$ - zen_billed_$
//   tui_delta_$       = tui_$        - zen_billed_$
//
// All fxp8 INTEGER in storage; format as decimals at display time only.
// Default output is a column-aligned table; pass --csv or --json to
// override.
//
// THIS FILE IS A STUB. Phase 4 fills in the join + formatter; see
// PLAN.md §6 Phase 4.

// Phase 4 fills in:
//
//   export async function runReconciliation(argv: string[]): Promise<number>
//     - parse --month (YYYY-MM; defaults to current)
//     - parse --json / --csv / (default: aligned-table)
//     - open ~/.local/state/opencode-cost.db readonly
//     - SQL (sketch):
//
//        WITH recomputed AS (
//          SELECT substr(ts_created, 1, 10) AS date,
//                 model_id                  AS model,
//                 SUM(cost_recomputed_fxp8) AS rc_fxp8,
//                 SUM(cost_opencode_fxp8)   AS tui_fxp8
//          FROM messages
//          WHERE substr(ts_created, 1, 7) = ?            -- 'YYYY-MM'
//          GROUP BY date, model
//        ),
//        billed AS (
//          SELECT date, model, SUM(total_cost_fxp8) AS zen_fxp8
//          FROM zen_daily_billed
//          WHERE substr(date, 1, 7) = ?
//          GROUP BY date, model
//        )
//        SELECT
//          COALESCE(r.date,  b.date)  AS date,
//          COALESCE(r.model, b.model) AS model,
//          r.rc_fxp8,
//          r.tui_fxp8,
//          b.zen_fxp8,
//          (r.rc_fxp8  - b.zen_fxp8)  AS recompute_delta_fxp8,
//          (r.tui_fxp8 - b.zen_fxp8)  AS tui_delta_fxp8
//        FROM recomputed r
//        FULL OUTER JOIN billed b USING (date, model)
//        ORDER BY date DESC, model;
//
//     - format with right-aligned $ columns (divide by 1e8 at print time)
//     - return process exit code
