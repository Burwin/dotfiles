# OpenCode Cost — Per-Task tmux Status Bar — PLAN.md

Status: proposal (2026-05-19); implementation not yet started.
Owner: mbh
Origin session: 2026-05-19 — extended planning rooted in two facts:

1. The freshly-shipped `opencode-cost-tmux-status` bar (v1, ~30min
   lifespan) shows global daily/total spend; user wants per-task scope
   matching the currently active toggl project/task.
2. The per-request PLAN's §10 already specified the acceptance tests
   for per-task / per-project / per-client rollup. The bar is the
   visible surface of those tests' subject.

This PLAN consolidates everything needed to ship a per-task bar
end-to-end: plugin capture-bug fix, Phase 5 backfill from
`opencode.db`, full per-request Zen integration (Z0-Z3), `dump
by-toggl` CLI with §10 acceptance tests, and the bar rewrite.

## Sibling / source plans

This PLAN supersedes or subsumes content from several earlier docs.
Final state after Commit 6:

| Source plan | Disposition |
|---|---|
| `../opencode-cost-tmux-status/PLAN.md` (v1) | Moved to `docs/archive/opencode/PLAN-cost-tmux-status-v1.md` with a supersession note. Decision history preserved. |
| `../opencode-cost-zen-per-request/PLAN.md` | Moved to `docs/archive/opencode/PLAN-cost-zen-per-request.md` with a supersession note. Z0-Z5 + §10 are absorbed here verbatim; Z6/Z7 dropped (Z6 was optional sanity check; Z7 was "update other plans", which is this work). |
| `../opencode-cost-breakdown/PLAN.md` | Kept in place. Option A (per-toggl-project breakdown via worktree JOIN) marked superseded by §7 + §10 of this PLAN. Option B (per-tmux-session) preserved as reference; not implemented. |
| `../opencode-cost-tracker/PLAN.md` | Kept in place. Parent design doc; Phases 1-4 stand. Phase 5 (`import-opencode` backfill) shipped under Commit 2 of this PLAN; Progress entry references this PLAN. |

## Progress

- 2026-05-19 — PLAN drafted; no code yet. Six-commit execution checklist
  in §9; tests-before-code ordering for the per-request work (Z0' / Z3'
  RED scaffolds land in Commit 3 before Z0/Z3 GREEN in Commit 4).

---

## 1. Problem

The tmux bar shipped this afternoon shows global Zen-billed totals:

```
daily-cost: $142 | total-cost: $1378 | client: Bamboo | proj: Internal | task: MASTER-1703 | …
```

The user wants per-task spend instead — i.e., daily and total **scoped
to the toggl task associated with the active pane**. The semantics are
already specified by the per-request PLAN's §10 acceptance tests
(per-client, per-project, per-task rollups via `zen_usage → messages →
toggl_repo_state`). The bar is a thin visible surface over the same
data path.

Three independent gaps must close before the bar can render real
numbers:

1. **`messages` is empty.** The cost-tracker plugin loads but doesn't
   write rows. 51 `message.updated` events fired in the current
   session; zero rows. Until the capture bug is fixed, the bar has
   no join key to toggl.
2. **`zen_usage` doesn't exist.** Per-request PLAN's Z1 is unstarted.
   `zen_daily_billed` (the only Zen table populated today) has no
   `session_id` and no `worktree_path` columns — it can't be sliced
   by toggl. The per-row endpoint (Z3) is the source.
3. **History gap.** Even after the capture bug is fixed, `messages`
   only fills going forward. Days/weeks of past opencode work would
   render as `$0` on the bar. Phase 5 backfill (cost-tracker PLAN §6
   Phase 5) reads `~/.local/share/opencode/opencode.db` to fill
   history.

All three are addressed below.

---

## 2. Locked decisions

| # | Question | Answer | Source turn |
|---|---|---|---|
| 1 | Cost scope | Per-task (`toggl_repo_state.task` JOIN) | per-task pivot |
| 2 | Data source | Zen-billed via `zen_usage → messages → toggl` (the full §10.1.c join) — possible because Z1 ships in this work | per-task pivot + scope expansion |
| 3 | Labels | `daily-cost` / `total-cost` (kept) | per-task pivot |
| 4 | Unmapped pane | `cost: (unmapped) \| ` | per-task pivot |
| 5 | Mapped no-spend yet | `daily-cost: $0 \| total-cost: $0 \| ` (honest) | per-task pivot |
| 6 | Plugin capture bug | Investigate + fix inline; 45min static budget, then instrument | per-task pivot + scope expansion |
| 7 | History gap | Full Phase 5 backfill + reconcile against `zen_daily_billed` | scope expansion |
| 8 | `toggl.db` missing | CLI errors loudly (non-zero exit); bar silently degrades to `cost: (unmapped)` | scope expansion |
| 9 | CLI surface | `opencode-cost dump by-toggl --group-by task\|project\|client` (Z5) | scope expansion |
| 10 | Acceptance tests | §10 verbatim, fixture uses `zen_usage` per §10.1.b | scope expansion |
| 11 | Bar implementation form | Separate bash script with own SQL (no Bun spawn on each tmux tick) | scope expansion |
| 12 | Sync timer cadence | `OnCalendar=*:0/10` (shipped in v1) | tmux-status v1 |
| 13 | Round-up math | Ceiling-by-floor: `(x + 99999999) / 100000000` (shipped in v1) | tmux-status v1 |
| 14 | Master PLAN form | This file. Archives `opencode-cost-tmux-status/` v1 and `opencode-cost-zen-per-request/`; marks `opencode-cost-breakdown/` Option A superseded | scope expansion |
| 15 | Session segmentation | One agent session per commit (6 sessions) | scope expansion |

---

## 3. Architecture

Three loosely-coupled subsystems, all converging on
`~/.local/state/opencode-cost.db`:

```
                          ╔════════════════════════════════════╗
                          ║  ~/.local/state/opencode-cost.db   ║
                          ║                                    ║
opencode plugin           ║  messages (per-message; per-       ║
(cost-tracker.ts)  ──────▶║   session capture incl.            ║
                          ║   worktree_path)                   ║
                          ║                                    ║
opencode-cost CLI         ║  zen_usage (per-Zen-row incl.      ║
(zen-sync.ts after Z3) ──▶║   session_id; new in Z1)           ║
                          ║                                    ║
opencode-cost CLI         ║  zen_daily_billed (derived rollup  ║
(reconcile.ts) ──────────▶║   of zen_usage; existing surface)  ║
                          ║                                    ║
opencode-cost CLI         ║  session_rollup, provider_rates    ║
(import-opencode after    ║   (existing)                       ║
 Phase 5) ───────────────▶║                                    ║
                          ╚════════════════════════════════════╝
                                          │
                                          │  ATTACH DATABASE
                                          ▼
                          ╔════════════════════════════════════╗
                          ║  ~/.local/state/toggl/state.db     ║
                          ║                                    ║
                          ║  toggl_repo_state                  ║
                          ║   (worktree_path → client, proj,   ║
                          ║    task — managed by toggl-time)   ║
                          ╚════════════════════════════════════╝

  Readers:
   - opencode-cost dump by-toggl     (CLI surface, §10.1.f)
   - opencode-cost-tmux-status       (bar surface, §11)
   - opencode-cost dump reconciliation
       --by-message                  (per-message reconcile, §6.2)
   - opencode-cost dump zen-usage    (raw zen_usage rows, §7)
   - opencode-cost dump by-session-zen
                                     (session totals from zen_usage)
```

### 3.1 File map (final state)

```
dotfiles/opencode/.config/opencode/
├── plugins/
│   ├── notify.ts                              (unchanged)
│   ├── cost-tracker.ts                        (MODIFY in Commit 1 — fix capture bug)
│   └── cost-tracker/
│       ├── db.ts                              (MODIFY in Commit 4 — Z1 schema + Z2 ALTER)
│       ├── rate-table.ts                      (unchanged)
│       └── recompute.ts                       (unchanged)
├── bin/
│   ├── opencode-cost                          (MODIFY — dispatch import-opencode, dump by-toggl)
│   └── opencode-cost-tmux-status              (REWRITE in Commit 6 — per-task SQL)
└── opencode-cost/
    ├── dump.ts                                (unchanged)
    ├── zen-sync.ts                            (REWRITE in Commit 4 — Z0+Z3 per-row)
    ├── reconcile.ts                           (MODIFY in Commit 5 — --by-message)
    ├── by-toggl.ts                            (NEW in Commit 5 — Z5)
    ├── import-opencode.ts                     (NEW in Commit 2 — Phase 5 backfill)
    ├── parser.ts                              (NEW or extracted in Commit 4 — Z0)
    └── __tests__/
        ├── __fixtures__/
        │   └── parser/
        │       ├── empty-rows.txt             (§10.7.d)
        │       ├── shape-drift.txt            (§10.7.f)
        │       ├── chunked.txt                (§10.7.c)
        │       └── … (per §10.7 cases)
        ├── zen-sync.parser.test.ts            (NEW in Commit 3 — Z0' tests)
        ├── zen-sync.loop.test.ts              (NEW in Commit 3 — Z3' tests)
        └── by-toggl.test.ts                   (NEW in Commit 5 — §10.5 + §10.2/3/4 tests)

tmux/.config/tmux/tmux.conf                    (already updated in v1; no change in Commit 6)

~/.local/state/opencode-cost.db                (schema additions in Commit 4)
~/.local/state/opencode-cost/zen-sync.lock     (flock advisory, new in Commit 4 / §5.3)
~/.config/opencode-cost/config.json            (existing; tz_offset marked deprecated)
~/.config/opencode/secrets/zen-session-cookie  (existing)
```

---

## 4. Schema

### 4.1 New: `zen_usage` (Commit 4 / Z1)

```sql
CREATE TABLE zen_usage (
  id                       TEXT PRIMARY KEY,        -- usg_*
  workspace_id             TEXT NOT NULL,
  session_id               TEXT,                    -- ses_*; nullable for legacy
  key_id                   TEXT NOT NULL,
  model                    TEXT NOT NULL,
  provider                 TEXT NOT NULL,
  time_created             TEXT NOT NULL,           -- ISO 8601
  time_updated             TEXT NOT NULL,
  time_deleted             TEXT,
  input_tokens             INTEGER NOT NULL,
  output_tokens            INTEGER NOT NULL,
  reasoning_tokens         INTEGER,                 -- null for anthropic
  cache_read_tokens        INTEGER NOT NULL,
  cache_write_5m_tokens    INTEGER,                 -- null for fireworks
  cache_write_1h_tokens    INTEGER,                 -- null for fireworks
  cost_fxp8                INTEGER NOT NULL,
  enrichment_json          TEXT,                    -- forward-compat
  fetched_at               TEXT NOT NULL,
  raw_json                 TEXT                     -- post-parse snapshot for replay
);
CREATE INDEX idx_zen_usage_session ON zen_usage(session_id);
CREATE INDEX idx_zen_usage_day     ON zen_usage(substr(time_created, 1, 10), model);
CREATE INDEX idx_zen_usage_time    ON zen_usage(time_created);
```

### 4.2 `zen_daily_billed` becomes derived

After each `zen-sync` run, rebuild from `zen_usage`:

```sql
INSERT OR REPLACE INTO zen_daily_billed (date, model, key_id, plan, total_cost_fxp8, fetched_at)
SELECT substr(time_created, 1, 10), model, key_id, NULL,
       SUM(cost_fxp8), MAX(fetched_at)
FROM zen_usage
GROUP BY 1, 2, 3;
```

Existing `dump reconciliation` (daily) keeps working unchanged.

### 4.3 `messages` cache TTL split (Commit 4 / Z2)

```sql
ALTER TABLE messages ADD COLUMN tokens_cache_write_5m INTEGER;
ALTER TABLE messages ADD COLUMN tokens_cache_write_1h INTEGER;
-- tokens_cache_write keeps living as the sum (backward compat).
```

`plugins/cost-tracker.ts` is updated in the same commit to read
`tokens.cache.write.5m` and `tokens.cache.write.1h` from opencode's
`AssistantMessage` payload (confirm exact field names during
implementation — may be `cache_write_5m` etc.) and write all three
(5m, 1h, sum).

Backfill not needed at the moment of the ALTER — Commit 1's capture
fix means `messages` starts populating with the new columns
populated from day one of writes.

### 4.4 Existing tables unchanged

`messages`, `session_rollup`, `provider_rates` keep their existing
shapes from cost-tracker PLAN §5. The capture-bug fix in Commit 1
doesn't alter the schema; it just makes the existing writes actually
work.

---

## 5. Sync loop (Commit 4 / Z3)

### 5.1 Per-page fetch (replaces 4-arg daily aggregate)

```ts
const fetchPage = async (page: number, cookie: string, config: ZenSyncConfig) => {
  const body = JSON.stringify({
    t: { t: 9, i: 0, l: 2, a: [
      { t: 1, s: config.workspaceId },
      { t: 0, s: page },
    ], o: 0 },
    f: 31,
    m: [],
  })
  const res = await fetch("https://opencode.ai/_server", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cookie": cookie,
      "origin": "https://opencode.ai",
      "referer": `https://opencode.ai/workspace/${config.workspaceId}/usage`,
      "x-server-id": config.serverId,
      "x-server-instance": "server-fn:0",
    },
    body,
  })
  // existing chunk-prefix strip + parseServerResponse (with new Date() extension from Z0)
  // walk $R[0] (an array) and normalize each row
  return rows
}
```

### 5.2 Pagination loop with stop conditions

```ts
const PAGE_SIZE = 50  // empirically observed; treat <50 as last page

const syncAll = async (cookie, config, mode: "incremental" | "full") => {
  const newestKnown = mode === "incremental"
    ? db.query("SELECT MAX(time_created) FROM zen_usage WHERE workspace_id = ?")
        .get(config.workspaceId)?.[0]
    : null
  for (let page = 0; page < 1000; page++) {
    const rows = await fetchPage(page, cookie, config)
    if (rows.length === 0) return                                 // empty page → end
    db.upsert(rows)                                                // INSERT OR REPLACE BY id
    if (rows.length < PAGE_SIZE) return                            // short page → end
    if (mode === "incremental" && newestKnown &&
        rows.every(r => r.time_created <= newestKnown)) return     // overlap with known
  }
  throw new Error("zen-sync: exceeded 1000-page safety cap")
}
```

Stop conditions:
1. Empty page → end of stream.
2. <50 rows → last page.
3. Incremental: all rows in current page ≤ `newestKnown` → known territory reached.
4. Safety cap at 1000 pages (50K rows).

**Mid-sync arrivals are accepted as eventual consistency.** Rows that
arrive after their would-be page has been fetched are not retrieved in
the current run. They surface on the next incremental sync because
`MAX(time_created)` advances past them and they're returned at the top
of page 0. See §11 open items if drift becomes visible.

### 5.3 Concurrent sync protection

Linux `flock(2)` advisory exclusive lock at
`~/.local/state/opencode-cost/zen-sync.lock` to prevent the systemd
timer + a manual run racing. PID and start-time written into the file
for diagnostics; `flock` semantics handle stale-process release (kernel
drops the lock on process exit). Contending callers exit code 75
("retry later") with a one-line diagnostic.

---

## 6. Reconciliation

### 6.1 Daily reconcile (existing path, unchanged)

`opencode-cost dump reconciliation [--month YYYY-MM]` keeps reading
`zen_daily_billed`. The table is now derived from `zen_usage` (per
§4.2) rather than populated by a separate daily-aggregate API call,
but the SQL surface stays identical.

### 6.2 Per-message reconcile (new in Commit 5)

`opencode-cost dump reconciliation --by-message [--session ses_xxx] [--since YYYY-MM-DD]`

```sql
SELECT
  m.session_id,
  m.ts_created                                                AS local_ts,
  zu.time_created                                             AS zen_ts,
  m.model_id,
  printf('$%.4f', m.cost_opencode_fxp8 / 1e8)                 AS tui,
  printf('$%.4f', zu.cost_fxp8 / 1e8)                         AS zen,
  printf('$%+.4f', (zu.cost_fxp8 - m.cost_opencode_fxp8) / 1e8) AS drift,
  (m.tokens_input         - zu.input_tokens)                   AS input_delta,
  (m.tokens_output        - zu.output_tokens)                  AS output_delta,
  (m.tokens_cache_read    - zu.cache_read_tokens)              AS cache_read_delta,
  (m.tokens_cache_write_5m - zu.cache_write_5m_tokens)         AS cache_5m_delta,
  (m.tokens_cache_write_1h - zu.cache_write_1h_tokens)         AS cache_1h_delta
FROM messages m
LEFT JOIN zen_usage zu
  ON zu.session_id = m.session_id
  AND zu.model     = m.model_id
  AND ABS(strftime('%s', zu.time_created) - strftime('%s', m.ts_created)) < 5
WHERE m.ts_created >= COALESCE(:since, m.ts_created)
ORDER BY m.ts_created DESC;
```

5-second join window absorbs clock skew between opencode's local
capture timestamp and Zen's server-side row timestamp.

`cost_recomputed_fxp8` is omitted from this view; per the per-request
PLAN's R5 decision, with per-row Zen truth available the tier-aware
recompute becomes diagnostic-only. See §11 for the long-term position.

---

## 7. CLI surfaces

Final state after all commits:

| Subcommand | Status | Behavior |
|---|---|---|
| `opencode-cost dump messages [--since] [--json\|--csv]` | unchanged | Reads `messages` |
| `opencode-cost dump sessions [--since] [--json\|--csv]` | unchanged | Reads `session_rollup` |
| `opencode-cost dump reconciliation [--month] [--json\|--csv\|--table]` | unchanged surface; data source now derived from `zen_usage` | Daily reconcile |
| `opencode-cost dump reconciliation --by-message [--session] [--since]` | NEW (Commit 5) | Per-message join, §6.2 |
| `opencode-cost zen-sync` | rewritten in Commit 4 | Incremental per-row sync; flock; default mode |
| `opencode-cost zen-sync --full` | NEW (Commit 4) | Backfill all history; paginates until empty/short |
| `opencode-cost zen-sync --dry-run` | NEW (Commit 4) | Fetch + parse + diff against DB, no writes |
| `opencode-cost zen-sync --max-pages N` | NEW (Commit 4) | Safety cap override |
| `opencode-cost dump zen-usage [--session] [--since] [--json\|--csv\|--table]` | NEW (Commit 5) | Read `zen_usage` directly |
| `opencode-cost dump by-session-zen [--since]` | NEW (Commit 5) | Group `zen_usage` by session, totals |
| `opencode-cost dump by-toggl --group-by task\|project\|client [--since] [--until] [--toggl-db] [--include-unmapped] [--include-unattributed] [--no-model-split] [--json\|--csv\|--table]` | NEW (Commit 5 / Z5) | Per-§10.1.f. Errors loudly when `toggl.db` is missing. |
| `opencode-cost import-opencode [--since YYYY-MM-DD] [--dry-run] [--reconcile]` | NEW (Commit 2) | Phase 5 backfill from `~/.local/share/opencode/opencode.db` into `messages`. `--reconcile` mode runs a SUM-by-(date,model) drift report against `zen_daily_billed`. |

### 7.1 `dump by-toggl` column shapes (per §10.1.f)

```
--group-by task    : client | project | task    | model | cost_usd
--group-by project : client | project           | model | cost_usd
--group-by client  : client                     | model | cost_usd

with --no-model-split, drop the `model` column from each.
```

Default `--table` aligned dollars; `--json`/`--csv` keep fxp8 INTEGER
columns (mirrors `dump messages`/`dump sessions` contract).

---

## 8. Fragility budget

| Failure mode | Detection | Recovery |
|---|---|---|
| Cookie expires (~Jun 2027) | HTTP 401 / redirect to login | Recapture from DevTools; existing runbook in cost-tracker PLAN §8 |
| `x-server-id` rotates on Zen deploy | HTTP 404/500 or unexpected body | Re-scrape from workspace HTML; runbook in cost-tracker PLAN §8 |
| Page size constant (50) changes | Premature stop or runaway | Lower-bound the page-size check to ≥30; warn loud when unexpected. Test §10.6.i and §10.6.j pin behavior in both directions. |
| Pagination becomes stable / cursor-based | Old loop returns garbage | Body shape mismatch surfaces via parser; bail loud + dump |
| Per-row response shape changes (new fields) | Existing parser drops unknown fields silently | Add diff-detection: hash known field set; warn when new fields appear |
| `new Date(...)` literal replaced with ISO string | Parser regex misses, treats as undefined | Defensive: parser accepts both `new Date("…")` and bare ISO string |
| Schema drift on `enrichment` becoming non-null | Currently a blob | Stored as JSON in `enrichment_json`; surface in `dump zen-usage` with `--show-enrichment` |
| Multi-key BYOK | Currently single key in `keys` array | `key_id` on each row; no special handling needed |
| Concurrent sync runs (timer + manual) | Race on insert | `flock` at `~/.local/state/opencode-cost/zen-sync.lock`, exit 75 on contention |
| `toggl.db` missing on `dump by-toggl` | ATTACH fails | Error loudly, non-zero exit, point at `toggl-set` (per §10.1.e) |
| `toggl.db` missing on bar | Same | Silently render `cost: (unmapped)` (per locked decision #8) |
| Plugin capture writes silently fail | `messages` row count doesn't grow despite events | Commit 1 fix path. Add `[cost-tracker]` warnings on every drop branch in the handler |

---

## 9. Phases + commit order

Six commits. Each is independently shippable and ff-mergeable; stopping
at any boundary leaves a working system with reduced scope.

### Commit 1 — Capture-bug fix (~1-2h)

```
Goal: messages table starts writing rows again.

[ ] P1.0  Read @opencode-ai/plugin event payload types from node_modules;
          confirm shape of message.updated payload vs. cost-tracker.ts's
          assumptions (event.properties.message.id, p.sessionID, the
          `worktree` arg). 45min static budget.
[ ] P1.1  If static is unclear: add diagnostic
            fs.appendFileSync('/tmp/cost-tracker-debug.log', JSON.stringify({
              type: e.type, p, hasMsg: !!p.message, msgId: p.message?.id,
              worktree: worktreePath, dbReady: !!db
            }) + '\n')
          at the top of the event handler. Restart opencode.
          Ask user to leave it running through normal work; collect samples.
[ ] P1.2  Identify root cause from logs / static analysis.
          Hypotheses ranked: (a) payload shape drift (event.properties
          flattened, msg path changed); (b) worktree arg undefined →
          NOT NULL violation; (c) bun:sqlite import fails silently and
          db is null with no warning surfaced; (d) something else.
[ ] P1.3  Fix in plugins/cost-tracker.ts (and plugins/cost-tracker/db.ts
          if the bug is on the DB side). Remove the diagnostic.
          Add console.warn on every silent-drop branch so future
          regressions are visible.
[ ] P1.4  Verify: restart opencode, send one prompt, observe
          COUNT(*) FROM messages > 0. Also check session_rollup
          populates on session.idle and provider_rates has at least
          one row after rate-table fetch settles.
[ ] P1.5  Add Progress entry on docs/plans/opencode-cost-tracker/PLAN.md
          ("Plugin capture bug fixed; messages and session_rollup
          now writing as designed. Root cause: <X>.").
[ ] P1.6  Commit on MASTER-1703:
          "fix: cost-tracker plugin capture (messages table now writes)"
[ ] P1.7  Do not ff-merge to m yet (Commit 6 batches the final merge);
          OR ff-merge incrementally per session — your call.

Files touched: plugins/cost-tracker.ts, possibly plugins/cost-tracker/db.ts,
docs/plans/opencode-cost-tracker/PLAN.md.
```

### Commit 2 — Phase 5 backfill + reconcile (~2-3h)

```
Goal: messages table has historical rows from opencode.db for all
sessions before Commit 1's fix landed. Reconciles against
zen_daily_billed to surface any drift.

[ ] P2.0  Inspect ~/.local/share/opencode/opencode.db schema.
          Cost-tracker PLAN §6 Phase 5 says:
            json_extract(data, '$.type') = 'step-finish'
          in the `part` table carries cost/token snapshot.
          Confirm by spot-checking a few rows; document the exact
          extraction shape.
[ ] P2.1  Write opencode-cost/import-opencode.ts:
            - Open opencode.db READ-ONLY
            - For each step-finish part row, extract:
                message_id, session_id (from message FK),
                worktree_path (from session.directory or equivalent),
                provider_id, model_id, agent, ts_created, ts_completed,
                tokens.*, cost (opencode-side), finish, raw_json
            - Compute cost_recomputed_fxp8 using current rate table
              (fetch /config/providers via the running opencode HTTP server,
               or use the most recent provider_rates snapshot if present)
            - INSERT OR IGNORE into messages (id-based dedup; do not
              clobber rows the plugin captured natively)
            - Also reconstruct session_rollup rows from the freshly-
              backfilled messages
[ ] P2.2  Wire `import-opencode` subcommand in bin/opencode-cost.
          Flags:
            --since YYYY-MM-DD  (default: all)
            --dry-run           (report what would be inserted, no writes)
            --reconcile         (after insert, SUM(messages) by date,model
                                 vs zen_daily_billed; report drift)
[ ] P2.3  Verify on real data:
            opencode-cost import-opencode --dry-run     # row counts
            opencode-cost import-opencode               # actual
            opencode-cost import-opencode --reconcile   # drift report
          Sanity: today's date should show messages SUM close to
          zen_daily_billed (within a few % drift documented in
          cost-tracker PLAN §2).
[ ] P2.4  Add Progress entry on docs/plans/opencode-cost-tracker/PLAN.md
          marking Phase 5 shipped, with the row count and drift summary.
[ ] P2.5  Commit on MASTER-1703:
          "feat: opencode-cost import-opencode backfill + reconcile"

Files touched: opencode-cost/import-opencode.ts (new), bin/opencode-cost,
docs/plans/opencode-cost-tracker/PLAN.md.
```

### Commit 3 — per-request RED scaffolds (Z0', Z3') (~1.25h)

```
Goal: parser and sync-loop acceptance tests are checked in and FAILING
because Z0 and Z3 haven't been implemented yet. This locks the
behavioral contract before the production code is touched.

[ ] P3.0  Set up test runner. Bun's built-in `bun test` is already in
          use elsewhere in this repo (verify by checking
          opencode-cost/package.json if present; otherwise mirror
          bamboo/tools' Bun test pattern).
[ ] P3.1  Z0' parser tests in
          opencode-cost/__tests__/zen-sync.parser.test.ts:
            - 10.7.a `new Date("...")` → ISO string
            - 10.7.b shared $R[N] back-refs
            - 10.7.c chunked stream prefixes (3 variants)
            - 10.7.d empty $R[0] = []
            - 10.7.e missing $R[0]
            - 10.7.f shape drift (new field) — decide on first run:
                surface in enrichment_json OR warn-and-drop. Test
                pins whichever we pick.
            - 10.7.g numeric edges (0, negative, float, exponent,
                null for nullable fields)
            - 10.7.h string escapes
            - 10.7.i no eval / no Function escape hatch
          Fixtures in opencode-cost/__tests__/__fixtures__/parser/.
[ ] P3.2  Z3' sync-loop tests in
          opencode-cost/__tests__/zen-sync.loop.test.ts:
            - 10.6.a empty page → clean exit
            - 10.6.b short page → no page 1
            - 10.6.c full then empty
            - 10.6.d full then short
            - 10.6.e incremental stop on newestKnown overlap
            - 10.6.f full backfill ignores newestKnown
            - 10.6.g dedup by id
            - 10.6.h safety cap at 1000 pages
            - 10.6.i page-size drift down (30 rows treated as short)
            - 10.6.j page-size drift up (100 rows accepted, continues)
            - 10.6.k concurrent lock (exit 75)
            - 10.6.l mid-sync arrivals not picked up this run
          Mock _server is an in-process fake holding an array of rows
          and returning slices on (workspaceId, page) requests.
[ ] P3.3  Run `bun test` → expect all parser + loop tests to FAIL.
          That's the RED signal. Save the test output as evidence.
[ ] P3.4  Add Progress entry on this PLAN ("Commit 3: Z0' + Z3' RED
          scaffolds landed; N parser tests, M loop tests, all
          currently failing because Z0/Z3 unstarted.").
[ ] P3.5  Commit on MASTER-1703:
          "test: scaffold zen-sync parser + sync-loop tests (RED)"

Files touched: opencode-cost/__tests__/zen-sync.parser.test.ts (new),
opencode-cost/__tests__/zen-sync.loop.test.ts (new),
opencode-cost/__tests__/__fixtures__/parser/ (new),
docs/plans/opencode-cost-pertask-tmux-status/PLAN.md.
```

### Commit 4 — per-request GREEN (Z0 + Z1 + Z2 + Z3) (~2.5h)

```
Goal: Z0' + Z3' tests from Commit 3 now pass. Live smoke against Zen
produces real zen_usage rows.

[ ] P4.0  Z0 — extend the existing $R[n] parser in opencode-cost/
          zen-sync.ts (or extract to opencode-cost/parser.ts if it's
          getting long) to recognize `new Date("...")` literals and
          surface them as ISO strings. Single new prefix in the value
          parser. Z0' tests should now go GREEN.
[ ] P4.1  Z1 — schema additions in plugins/cost-tracker/db.ts:
            - Add CREATE TABLE zen_usage to BOOTSTRAP_SQL
            - Add migration call so existing DBs pick it up:
                db.exec("CREATE TABLE IF NOT EXISTS zen_usage (...);")
            - Add CREATE INDEX statements
            - zen_daily_billed table stays; populate from zen_usage
              after each sync (UPSERT GROUP BY date,model,key_id)
[ ] P4.2  Z2 — capture-side cache TTL split:
            - ALTER TABLE messages ADD COLUMN tokens_cache_write_5m INTEGER
            - ALTER TABLE messages ADD COLUMN tokens_cache_write_1h INTEGER
            - Update BOOTSTRAP_SQL with the columns for fresh DBs
            - Update plugins/cost-tracker.ts handler to read
              tokens.cache.write.5m / .1h (confirm exact field names
              from opencode payload during impl) and write all three
              (5m, 1h, sum)
[ ] P4.3  Z3 — rewrite opencode-cost/zen-sync.ts:
            - Replace 4-arg daily-aggregate body with 2-arg per-row body
            - Implement pagination loop per §5.2
            - Implement flock per §5.3 (use Node's fs.openSync +
              fcntl-style locking, or shell out to flock(1) — but
              since we're in Bun, prefer a portable bun:sqlite-only
              path; if that's not viable, use `proper-lockfile` or
              hand-roll over fs)
            - UPSERT zen_usage; rebuild zen_daily_billed (§4.2)
          Z3' loop tests should now go GREEN.
[ ] P4.4  Live smoke:
            opencode-cost zen-sync --dry-run --max-pages 2
            # → should report N rows fetched, no DB writes
            opencode-cost zen-sync
            # → should fill zen_usage; zen_daily_billed rebuild matches
          Sanity: SUM(zen_usage.cost_fxp8) GROUP BY date,model should
          match the captured 4-arg fixture from §10's Z6 sanity check
          (one-time capture saved to __fixtures__/zen-daily-<date>.json).
[ ] P4.5  Update Progress entry on this PLAN ("Commit 4: Z0+Z1+Z2+Z3
          GREEN; X parser tests + Y loop tests pass; live sync wrote
          Z rows to zen_usage; zen_daily_billed regenerated; tokens
          cache TTL split active in messages.").
[ ] P4.6  Commit on MASTER-1703:
          "feat: zen-sync per-row pagination + zen_usage schema + cache TTL split"

Files touched: opencode-cost/zen-sync.ts (rewrite),
plugins/cost-tracker/db.ts (schema + ALTER), plugins/cost-tracker.ts
(cache TTL split), docs/plans/opencode-cost-pertask-tmux-status/PLAN.md.
```

### Commit 5 — Z5 dump by-toggl + §10 acceptance tests (~1.5-2h)

```
Goal: dump by-toggl produces the per-task / per-project / per-client
rollups specified in §10.2-§10.4. Acceptance tests pass.

[ ] P5.0  Write opencode-cost/by-toggl.ts implementing the §10.1.f
          surface:
            export const runByToggl = (argv: string[]): number => { ... }
          - Parse --group-by (required, one of task/project/client),
            --since, --until, --toggl-db, --include-unmapped /
            --no-include-unmapped, --include-unattributed /
            --no-include-unattributed, --no-model-split,
            --json/--csv/--table.
          - ATTACH toggl.db; if missing, exit 2 with diagnostic
            pointing at toggl-set (per §10.1.e).
          - SQL per §10.1.c join path. UNION the unmapped /
            unattributed buckets per §10.1.e.
          - Render per §10.1.f column shapes.
[ ] P5.1  Wire `dump by-toggl` subcommand in bin/opencode-cost.
[ ] P5.2  Write opencode-cost/reconcile.ts --by-message extension
          per §6.2.
[ ] P5.3  Write opencode-cost/__tests__/by-toggl.test.ts:
            - Build the shared fixture from §10.1.a-§10.1.b in memory
              (sqlite3 :memory: for opencode-cost.db and toggl.db)
            - §10.2 per-client rollup: assert exact output (rows,
              sort order, model split, --no-model-split collapse).
              Sum invariant: $16.10.
            - §10.3 per-project rollup: assert exact output.
            - §10.4 per-task rollup: assert exact output.
            - §10.1.d invariants:
                1. sum-up consistency (task → project → client → grand)
                2. deterministic attribution (no row contributes twice)
                3. stable across re-runs (byte-identical output)
                4. no float in aggregation (penny-or-better precision)
            - §10.1.e edge cases:
                a. unmapped worktree → (unmapped) bucket
                b. unattributed zen row → (no-local-capture) bucket
                c. retargeted via toggl-set mid-history → current
                   state authoritative
                d. title-gen / subagent inherit parent's mapping
                e. toggl.db missing → fail loud, non-zero exit
[ ] P5.4  Run `bun test`. All by-toggl tests should pass; Z0'/Z3'
          tests from Commit 3/4 should still pass.
[ ] P5.5  Also wire `dump zen-usage` and `dump by-session-zen` (simple
          reads on zen_usage, by spec from §7).
[ ] P5.6  Update Progress entry on this PLAN.
[ ] P5.7  Commit on MASTER-1703:
          "feat: opencode-cost dump by-toggl + per-message reconcile (Z5 + §10)"

Files touched: opencode-cost/by-toggl.ts (new), opencode-cost/reconcile.ts
(extend), bin/opencode-cost, opencode-cost/__tests__/by-toggl.test.ts (new),
docs/plans/opencode-cost-pertask-tmux-status/PLAN.md.
```

### Commit 6 — Bar v2 + docs cleanup + activation (~1h)

```
Goal: bar renders per-task daily/total in tmux. v1 + per-request PLANs
archived. Single PR-equivalent commit lands the whole thing.

[ ] P6.0  Rewrite opencode/.config/opencode/bin/opencode-cost-tmux-status
          per §11 of this PLAN. New SQL using the §10.1.c join path
          with a single-task filter.
[ ] P6.1  Move docs/plans/opencode-cost-tmux-status/PLAN.md →
          docs/archive/opencode/PLAN-cost-tmux-status-v1.md
          (use `git mv` so the move is recorded). Prepend a
          supersession header:

            > **Superseded** by
            > [docs/plans/opencode-cost-pertask-tmux-status/PLAN.md](../../plans/opencode-cost-pertask-tmux-status/PLAN.md)
            > on 2026-05-19. v1 shipped global daily/total figures;
            > v2 scopes per-task via the toggl JOIN per the per-request
            > PLAN's §10 contract. Decision history below preserved
            > as-is.

[ ] P6.2  Move docs/plans/opencode-cost-zen-per-request/PLAN.md →
          docs/archive/opencode/PLAN-cost-zen-per-request.md with the
          same kind of supersession header.
[ ] P6.3  Add Progress entry to docs/plans/opencode-cost-breakdown/
          PLAN.md marking Option A superseded by §7/§10 of this PLAN.
[ ] P6.4  Add Progress entry to docs/plans/opencode-cost-tracker/
          PLAN.md (the parent) noting:
            - Plugin capture bug fixed (Commit 1)
            - Phase 5 backfill shipped (Commit 2)
            - Per-row Zen integration + zen_usage shipped (Commit 4)
            - dump by-toggl shipped (Commit 5)
            - Bar v2 shipped (Commit 6)
          Update the parent's Progress block's "Next:" line.
[ ] P6.5  Final Progress entry on this PLAN: "Commit 6: bar v2 +
          docs archived. End-to-end working."
[ ] P6.6  Commit on MASTER-1703:
          "feat: per-task tmux cost bar + plan archive"
[ ] P6.7  Fast-forward merge all 6 commits MASTER-1703 → m:
            git -C ~/src/dotfiles merge --ff-only MASTER-1703
          (Sanity-check first: `git log m..MASTER-1703 --oneline`
           shows exactly 6 commits in expected order.)
[ ] P6.8  Activate live:
            tmux source-file ~/.config/tmux/tmux.conf
            # 5s status interval renders the new bar
[ ] P6.9  Verify bar shows per-task values in current pane (should be
          MASTER-1703 since cwd is this worktree). Compare to:
            opencode-cost dump by-toggl --group-by task --since 2026-05-01
              | grep MASTER-1703
[ ] P6.10 Spot-check in another pane (different worktree, e.g.
          ~/src/bamboo/ccs/...) to confirm pane-locality of the bar.

Files touched: opencode/.config/opencode/bin/opencode-cost-tmux-status
(rewrite); docs/plans/opencode-cost-tmux-status/ (moved); docs/plans/
opencode-cost-zen-per-request/ (moved); docs/plans/opencode-cost-
breakdown/PLAN.md (Progress); docs/plans/opencode-cost-tracker/PLAN.md
(Progress); docs/plans/opencode-cost-pertask-tmux-status/PLAN.md
(Progress).
```

### 9.1 Time-budget rollup

| Commit | Estimate |
|---|---|
| 1 | 1-2h |
| 2 | 2-3h |
| 3 | 1.25h |
| 4 | 2.5h |
| 5 | 1.5-2h |
| 6 | 1h |
| **Total** | **9.25-12h** |

---

## 10. Acceptance tests

Verbatim from the per-request PLAN §10. The contract here is what the
implementation must produce; deviating requires updating this PLAN
first.

### 10.1 Shared fixture for toggl-attribution rollup tests

Tests §10.2, §10.3, and §10.4 share one synthetic fixture and one
join path. This section defines them once.

#### 10.1.a Toggl state

`toggl_repo_state` (in `~/.local/state/toggl/state.db`) contains
exactly:

| `worktree_path`                              | `client_name` | `project_name` | `task`    |
|----------------------------------------------|---------------|----------------|-----------|
| `~/src/bamboo/ccs/kern/BAM-123`              | CCS           | Kern           | `BAM-123` |
| `~/src/bamboo/ccs/adventist/BAM-124`         | CCS           | Adventist      | `BAM-124` |
| `~/src/bamboo/schneller/hardening/SH-987`    | Schneller     | Hardening      | `SH-987`  |

#### 10.1.b Local capture

`messages` contains rows for six opencode sessions:

| session  | `worktree_path`                              | model            |
|----------|----------------------------------------------|------------------|
| `ses_A1` | `~/src/bamboo/ccs/kern/BAM-123`              | claude-opus-4-7  |
| `ses_A2` | `~/src/bamboo/ccs/kern/BAM-123`              | gpt-5-nano       |
| `ses_B1` | `~/src/bamboo/ccs/adventist/BAM-124`         | claude-opus-4-7  |
| `ses_B2` | `~/src/bamboo/ccs/adventist/BAM-124`         | claude-opus-4-7  |
| `ses_C1` | `~/src/bamboo/schneller/hardening/SH-987`    | claude-opus-4-7  |
| `ses_U1` | `~/src/bamboo/some/unmapped/dir`             | claude-opus-4-7  |

`zen_usage` contains rows for each of those sessions, plus one
"unattributed" row whose `sessionID` has no matching `messages` row:

| `zen_usage.session_id` | model            | `cost_fxp8`  | USD     |
|------------------------|------------------|--------------|---------|
| `ses_A1`               | claude-opus-4-7  | 500_000_000  | $5.00   |
| `ses_A2`               | gpt-5-nano       |  10_000_000  | $0.10   |
| `ses_B1`               | claude-opus-4-7  | 300_000_000  | $3.00   |
| `ses_B2`               | claude-opus-4-7  | 200_000_000  | $2.00   |
| `ses_C1`               | claude-opus-4-7  | 400_000_000  | $4.00   |
| `ses_U1`               | claude-opus-4-7  | 150_000_000  | $1.50   |
| `ses_X9` (no `messages` row) | claude-opus-4-7 |  50_000_000 | $0.50 |

Grand total: `1_610_000_000` fxp8 == `$16.10`.

#### 10.1.c Join path

```
zen_usage.session_id  =  messages.session_id
                         messages.worktree_path  =  toggl_repo_state.worktree_path
                                                    └─ supplies client_name / project_name / task
```

`zen_usage` rows without a `messages` join surface as `(no-local-capture)`.
`messages` rows whose `worktree_path` has no `toggl_repo_state` entry
surface as `(unmapped)`.

#### 10.1.d Shared invariants (apply to §10.2, §10.3, §10.4)

For any `(--since, --until)` window:

1. **Sum-up consistency.** Sum of per-task costs for project P equals
   per-`(client_of_P, P)` cost. Sum of per-`(client, project)` costs
   for client C equals per-client cost for C. Sum of all per-client
   costs equals `SUM(zen_usage.cost_fxp8)` over the window, provided
   `--include-unmapped` and `--include-unattributed` are both on
   (defaults). For the fixture: `$16.10` matches across all three
   rollup granularities.
2. **Deterministic attribution.** Each `zen_usage` row contributes
   to exactly one bucket. No double-counting; no dropped rows from
   sessions that DO have a worktree mapping.
3. **Stable across re-runs.** Running any of the three rollups twice
   with no intervening `zen-sync` MUST produce byte-identical output
   (modulo timestamps).
4. **No fxp8 → float round-trips inside aggregation.** All SUMs are
   integer-arithmetic in fxp8; divide by `1e8` only at display time.
   Penny-or-better precision MUST be preserved end-to-end.

#### 10.1.e Shared edge cases (apply to §10.2, §10.3, §10.4)

| Case | Expected behavior |
|------|-------------------|
| Unmapped worktree — `messages.worktree_path` not in `toggl_repo_state` (fixture row `ses_U1`) | Surfaced as `(unmapped)` bucket. Cost counted, not silently dropped. |
| Unattributed Zen row — `zen_usage.session_id` not in `messages` (fixture row `ses_X9`) | Surfaced as `(no-local-capture)` bucket via `LEFT JOIN messages`. Cost counted. |
| Worktree retargeted via `toggl-set` mid-history | Current `toggl_repo_state` is authoritative at query time. Historical rollups retroactively reflect new mapping. By design — no history table. |
| Title-gen / subagent sessions with same `worktree_path` as parent | Inherit parent's `(client, project, task)` naturally via the join. |
| `toggl.db` missing | Rollup query fails with `ATTACH DATABASE … failed: file not found — run \`toggl-set\` in at least one worktree to create it`. Non-zero exit code. |

Multi-worktree sessions (one `session_id` with ≥2 distinct
`worktree_path`s in `messages`) are deliberately out of scope here.
The simple `JOIN messages USING (session_id)` assumes 1-to-1 worktree
attribution. Tracked in §14 open items.

#### 10.1.f Shared CLI surface

```
opencode-cost dump by-toggl
  --group-by task|project|client       (required; one of)
  [--since YYYY-MM-DD] [--until YYYY-MM-DD]
  [--toggl-db <path>]                  (override; default ~/.local/state/toggl/state.db)
  [--include-unmapped]                 (default: include; --no-include-unmapped to exclude)
  [--include-unattributed]             (default: include)
  [--no-model-split]                   (drop `model` from GROUP BY)
  [--json|--csv|--table]               (default --table)
```

Column shape per mode (with model split, default):

```
--group-by task    : client | project | task    | model | cost_usd
--group-by project : client | project           | model | cost_usd
--group-by client  : client                     | model | cost_usd
```

### 10.2 Per-client rollup

**Given** the fixture in §10.1.
**When** `opencode-cost dump by-toggl --group-by client` is run with
no time-range filter.
**Then** output MUST contain exactly these rows (sort order:
`cost_usd` descending; ties broken by `client` ascending):

| client              | model           | cost_usd |
|---------------------|-----------------|----------|
| CCS                 | claude-opus-4-7 | $10.00   |
| Schneller           | claude-opus-4-7 | $4.00    |
| (unmapped)          | claude-opus-4-7 | $1.50    |
| (no-local-capture)  | claude-opus-4-7 | $0.50    |
| CCS                 | gpt-5-nano      | $0.10    |

Sum: `$16.10` (matches §10.1.d invariant 1).

CCS aggregates `ses_A1` ($5.00) + `ses_A2` ($0.10) + `ses_B1` ($3.00)
+ `ses_B2` ($2.00) across two projects.

With `--no-model-split`:

| client              | cost_usd |
|---------------------|----------|
| CCS                 | $10.10   |
| Schneller           | $4.00    |
| (unmapped)          | $1.50    |
| (no-local-capture)  | $0.50    |

### 10.3 Per-project rollup

**Given** the fixture in §10.1.
**When** `opencode-cost dump by-toggl --group-by project` is run.
**Then** rows (sort: `cost_usd` desc; ties broken by
`(client, project)` ascending):

| client              | project             | model           | cost_usd |
|---------------------|---------------------|-----------------|----------|
| CCS                 | Adventist           | claude-opus-4-7 | $5.00    |
| CCS                 | Kern                | claude-opus-4-7 | $5.00    |
| Schneller           | Hardening           | claude-opus-4-7 | $4.00    |
| (unmapped)          | (unmapped)          | claude-opus-4-7 | $1.50    |
| (no-local-capture)  | (no-local-capture)  | claude-opus-4-7 | $0.50    |
| CCS                 | Kern                | gpt-5-nano      | $0.10    |

Sum: `$16.10`.

CCS / Adventist aggregates `ses_B1` ($3.00) + `ses_B2` ($2.00) — the
test exercises summation across multiple sessions within one
task / project / client bucket.

### 10.4 Per-task rollup

**Given** the fixture in §10.1.
**When** `opencode-cost dump by-toggl --group-by task` is run.
**Then** rows (sort: `cost_usd` desc; ties broken by
`(client, project, task)` ascending):

| client              | project             | task                | model           | cost_usd |
|---------------------|---------------------|---------------------|-----------------|----------|
| CCS                 | Adventist           | BAM-124             | claude-opus-4-7 | $5.00    |
| CCS                 | Kern                | BAM-123             | claude-opus-4-7 | $5.00    |
| Schneller           | Hardening           | SH-987              | claude-opus-4-7 | $4.00    |
| (unmapped)          | (unmapped)          | (unmapped)          | claude-opus-4-7 | $1.50    |
| (no-local-capture)  | (no-local-capture)  | (no-local-capture)  | claude-opus-4-7 | $0.50    |
| CCS                 | Kern                | BAM-123             | gpt-5-nano      | $0.10    |

Sum: `$16.10`.

### 10.5 Test fixture implementation

Build a synthetic fixture in `opencode-cost/__tests__/by-toggl.test.ts`
that:

1. Creates an in-memory SQLite for `opencode-cost.db` with `messages`
   and `zen_usage` populated per §10.1.b.
2. Creates an in-memory SQLite for `toggl.db` (attached as `toggl`)
   with the three `toggl_repo_state` rows per §10.1.a.
3. Runs the three rollups (§10.2, §10.3, §10.4), each asserting the
   exact expected output and all four invariants from §10.1.d.
4. Separately exercises each edge case from §10.1.e (unmapped,
   unattributed, retargeted, title-gen, missing `toggl.db`) — at
   least one test per case.

Implementation MUST pass all three rollup tests before §10.2-§10.4
are considered complete.

### 10.6 Sync-loop acceptance tests

Scope: §5 pagination + stop conditions. **Scaffold before Z3.**

Given a mock `_server` that returns scripted page responses, when
`syncAll(cookie, config, mode)` runs, then:

| Case | Setup | Expected |
|------|-------|----------|
| **10.6.a Empty page** | Page 0 returns `[]` | Loop exits cleanly. No DB writes. Returns 0 rows. |
| **10.6.b Short page** | Page 0 returns 30 rows | Stores all 30. Does not fetch page 1. |
| **10.6.c Full then empty** | Page 0 = 50 rows; page 1 = `[]` | Stores 50. Exits at page 1. |
| **10.6.d Full then short** | Page 0 = 50; page 1 = 17 | Stores 67. Exits after page 1. |
| **10.6.e Incremental stop** | `newestKnown = T`. Page 0 returns 50 rows half newer / half older than T. Page 1 returns 50 rows all older than T. | Stores newer half from page 0. Does NOT paginate past page 1 (every row ≤ T triggers exit). |
| **10.6.f Full backfill ignores `newestKnown`** | `mode = "full"` with the same data as 10.6.e | Loop runs until empty/short regardless of `newestKnown`. |
| **10.6.g Dedup by `id`** | Same row `id` appears in page 0 and page 1 (simulates offset-shift overlap) | Exactly one row in DB; `fetched_at` reflects most recent upsert. |
| **10.6.h Safety cap** | Mock returns 50 rows forever | Loop throws `"zen-sync: exceeded 1000-page safety cap"` at page 1000. |
| **10.6.i Page-size drift down** | Mock returns 30 rows for page 0 | Loop exits (treats as short page). |
| **10.6.j Page-size drift up** | Mock returns 100 rows for page 0, 100 for page 1, `[]` for page 2 | Loop accepts 100-row pages and continues. No upper bound. |
| **10.6.k Concurrent lock** | Second process attempts `zen-sync` while first holds the flock | Exits with code 75; diagnostic line includes holder PID + start-time. First process unaffected. |
| **10.6.l Mid-sync arrivals** | Page 0 returns rows R0..R49. After fetch, 5 new rows R-5..R-1 arrive on the mock. Page 1 returns the simulated post-arrival window. | New rows are NOT picked up this run (eventual-consistency contract per §5.2). They DO appear on a subsequent incremental sync. |

Implementation note: the mock `_server` is a small in-process fake
that holds an array of rows and returns slices on `(workspaceId, page)`
requests.

### 10.7 Parser acceptance tests

Scope: §5 / Z0 envelope parsing. **Scaffold before Z0.**

Given a scripted `_server` response body, when the parser runs, then:

| Case | Input | Expected |
|------|-------|----------|
| **10.7.a `new Date("...")`** | Row with `timeCreated: new Date("2026-05-19T23:22:58.000Z")` | Field surfaces as ISO-8601 string `"2026-05-19T23:22:58.000Z"`. |
| **10.7.b Shared `$R[N]` back-refs** | `$R[2]` referenced from two row positions | Parsed graph preserves shared instance equality (one object, two references). |
| **10.7.c Chunked stream prefixes** | Three variants: `;0x<hex>;` at start; between rows; absent | All three produce byte-identical row arrays. |
| **10.7.d Empty `$R[0] = []`** | Server returns the empty-rows envelope | Returns empty array, no error. |
| **10.7.e Missing `$R[0]`** | Server returns a body without the rows slot | Throws loudly with a message pointing at the recovery runbook. |
| **10.7.f Shape drift (new field)** | Row has an unexpected top-level field | Decide on first run: surface in `enrichment_json` (forward-compat) or warn-and-drop. Test pins whichever we pick. |
| **10.7.g Numeric edges** | Fields: `0`, negative, float, exponent (`1e8`), `null` for nullable (reasoning, cache_5m/1h for fireworks) | Round-trip exactly. No silent coercion. |
| **10.7.h String escape sequences** | Strings containing `\n`, `\t`, `\"`, `\\` | Decoded correctly; no JSON-vs-JS-literal collision. |
| **10.7.i No `eval` / `Function` escape hatch** | Body contains an IIFE wrapper that would only execute via `eval` | Static parser walks the literal subset; refuses to invoke any JS evaluator. Test inspects the parser's call graph (or, if simpler, monkey-patches `eval`/`Function` and asserts they're never called). |

Implementation note: parser tests run against in-memory string fixtures
captured from real Zen responses (redacted where needed). Store them
in `opencode-cost/__tests__/__fixtures__/parser/`.

---

## 11. Bar surface spec

### 11.1 SQL contract

The bar runs every 5 seconds (tmux `status-interval`). It resolves the
current task from the active pane's path, then queries cost from
`zen_usage` joined to `messages` and `toggl_repo_state`. Single round-
trip:

```sql
ATTACH DATABASE '$HOME/.local/state/toggl/state.db' AS toggl;

WITH current_task AS (
    SELECT task, client_name, project_name
    FROM toggl.toggl_repo_state
    WHERE worktree_path = :worktree_root
       OR :worktree_root LIKE worktree_path || '/%'
    ORDER BY length(worktree_path) DESC
    LIMIT 1
)
SELECT
    COALESCE(
      SUM(CASE WHEN substr(zu.time_created, 1, 10) = date('now', 'localtime')
               THEN zu.cost_fxp8 ELSE 0 END),
      0
    ) AS today_fxp8,
    COALESCE(SUM(zu.cost_fxp8), 0)            AS total_fxp8,
    (SELECT task FROM current_task)           AS task
FROM zen_usage zu
JOIN messages m            ON m.session_id    = zu.session_id
JOIN toggl.toggl_repo_state r
                           ON r.worktree_path = m.worktree_path
JOIN current_task ct       ON ct.task         = r.task;
```

Bound parameter:
- `:worktree_root` — git toplevel of `$PWD` if available, else realpath
  of `$PWD`. Resolution order mirrors `toggl-tmux-status` to keep the
  two segments visually-aligned with what toggl thinks the current
  task is.

If `task` in the result row is NULL → no matching `toggl_repo_state`
row → render `cost: (unmapped) | `. Else render
`daily-cost: $X | total-cost: $Y | ` with ceil rounding.

### 11.2 Rendering

| State | Output |
|---|---|
| `task` resolved, `total_fxp8 = 0` | `daily-cost: $0 \| total-cost: $0 \| ` |
| `task` resolved, `total_fxp8 > 0` | `daily-cost: $<ceil> \| total-cost: $<ceil> \| ` |
| `task` is NULL (unmapped pane) | `cost: (unmapped) \| ` |
| DB or toggl.db missing or sqlite error | empty stdout (bar collapses) |

Style markup copies the v1 palette: `POP='#[fg=blue,bold]'` for
numbers, `MUTED='#[fg=brightblack,nobold]'` for labels and pipes.

### 11.3 Reference implementation (rewrite of v1)

```bash
#!/bin/bash
# opencode-cost-tmux-status — per-task daily/total spend from
# zen_usage joined to messages and toggl_repo_state.
#
# Per docs/plans/opencode-cost-pertask-tmux-status/PLAN.md §11.
#
# Hidden silently when:
#   - opencode-cost.db is missing
#   - toggl.db is missing (NOTE: dump by-toggl errors loudly on this;
#     the bar deliberately degrades silently per locked decision #8)
#   - sqlite3 errors
#
# Output when the active pane is in a toggl-mapped worktree:
#   daily-cost: $<ceil(today)> | total-cost: $<ceil(total)> |
#
# Output when the active pane has no toggl mapping:
#   cost: (unmapped) |
#
# Both figures round UP to the nearest dollar.

POP='#[fg=blue,bold]'
MUTED='#[fg=brightblack,nobold]'

DB_PATH="${OPENCODE_COST_DB:-$HOME/.local/state/opencode-cost.db}"
TOGGL_DB="${TOGGL_STATE_DB:-$HOME/.local/state/toggl/state.db}"

[[ -f "$DB_PATH" ]] || exit 0
[[ -f "$TOGGL_DB" ]] || exit 0

# Resolve the active pane's worktree root: prefer git-toplevel,
# fall back to realpath($PWD). Matches toggl-tmux-status.
worktree_root=$(git rev-parse --show-toplevel 2>/dev/null) \
    || worktree_root=$(realpath "$PWD" 2>/dev/null) \
    || worktree_root="$PWD"

# SQL-escape the worktree path for the literal substitution below.
# Safer than building the query in bash if we ever introduce paths
# with single quotes.
sql_quote() {
    local s=${1//\'/\'\'}
    printf "'%s'" "$s"
}
wr_lit=$(sql_quote "$worktree_root")

row=$(sqlite3 -readonly -separator $'\t' "$DB_PATH" "
    ATTACH DATABASE '$TOGGL_DB' AS toggl;

    WITH current_task AS (
        SELECT task, client_name, project_name
        FROM toggl.toggl_repo_state
        WHERE worktree_path = $wr_lit
           OR $wr_lit LIKE worktree_path || '/%'
        ORDER BY length(worktree_path) DESC
        LIMIT 1
    )
    SELECT
        COALESCE(
          SUM(CASE WHEN substr(zu.time_created, 1, 10) = date('now', 'localtime')
                   THEN zu.cost_fxp8 ELSE 0 END), 0),
        COALESCE(SUM(zu.cost_fxp8), 0),
        (SELECT task FROM current_task)
    FROM zen_usage zu
    JOIN messages m            ON m.session_id    = zu.session_id
    JOIN toggl.toggl_repo_state r
                              ON r.worktree_path = m.worktree_path
    JOIN current_task ct       ON ct.task         = r.task;
" 2>/dev/null) || exit 0

[[ -z "$row" ]] && exit 0

IFS=$'\t' read -r today_fxp8 total_fxp8 task <<<"$row"

if [[ -z "$task" ]]; then
    # No matching toggl row — render the unmapped pill.
    printf 'cost: %s(unmapped)%s | ' "$MUTED" "$MUTED"
    exit 0
fi

# Ceiling-by-floor on fxp8.
daily_usd=$(( (today_fxp8 + 99999999) / 100000000 ))
total_usd=$(( (total_fxp8 + 99999999) / 100000000 ))

printf 'daily-cost: %s$%d%s | total-cost: %s$%d%s | ' \
    "$POP" "$daily_usd" "$MUTED" \
    "$POP" "$total_usd" "$MUTED"
```

### 11.4 tmux.conf wiring

Already in place from v1; no change required in Commit 6. Reference:

```
set -g status-right "#[fg=brightblack]#(opencode-cost-tmux-status)#(cd '#{pane_current_path}' 2>/dev/null && PATH=$HOME/.local/bin:$PATH toggl-tmux-status) | #h "
```

### 11.5 Pane locality

Each pane's bar resolves `worktree_root` from its own
`pane_current_path` (via the `#()` shell's `$PWD`). Two panes in
different worktrees show different costs in the same tmux server.
Intentional; matches `toggl-tmux-status`.

### 11.6 toggl.db missing — divergent contracts

Locked decision #8: `dump by-toggl` errors loudly with non-zero exit
when `toggl.db` is missing (§10.1.e). The bar deliberately degrades
silently to avoid spamming the status line every 5 seconds. The two
surfaces have different UX needs; the contract divergence is
intentional and documented here so a future implementer doesn't
"fix" the bar to error loudly.

---

## 12. Plugin capture-bug investigation

Currently `messages` is empty despite 51 `message.updated` events in
the active session. Commit 1's first job is identifying why.

### 12.1 Symptom

```
$ sqlite3 ~/.local/state/opencode-cost.db "SELECT COUNT(*) FROM messages;"
0
$ grep -c 'message.updated' ~/.local/share/opencode/log/<latest>.log
51
$ grep -c '\[cost-tracker\]' ~/.local/share/opencode/log/<latest>.log
0
```

51 events; zero rows; zero warnings. The handler is being entered
(plugin loaded) but bailing or upserting to nowhere.

### 12.2 Static analysis (45min time-box)

Read in order:
1. `plugins/cost-tracker.ts` — handler at line 92-158. Note the
   silent-bail at line 93 (`if (!db) return`) and line 102
   (`if (!msg?.id) return`).
2. `plugins/cost-tracker/db.ts` — `openDb()` returns `null` on
   sqlite import failure, mkdir failure, or schema bootstrap
   failure. Each path has a `console.warn` but plugin stdout/stderr
   may not flow to opencode's log file.
3. `node_modules/@opencode-ai/plugin/*.d.ts` (or equivalent typings)
   — what is the actual event payload shape for `message.updated`
   in the current opencode version? Compare to handler assumptions:
     - `event.properties.message.id`
     - `event.properties.message.tokens.{input,output,reasoning,cache.read,cache.write}`
     - `event.properties.message.cost`
     - `event.properties.sessionID`
     - `event.properties.agent`
4. The `worktree` arg destructure on line 35. If opencode now
   passes a different argument bag (e.g. `{ directory }` instead of
   `{ worktree }`), `worktree` is undefined → `fs.realpathSync(undefined)`
   throws → fallback assigns `worktree` (still undefined) to
   `worktreePath` → upsert writes NULL → NOT NULL violation → silent
   swallow in handler try/catch.

Hypotheses ranked by likelihood:
- **A. Payload shape drift.** `msg = p.message` returns undefined
  because `message.updated` now puts the message at `p` directly,
  not `p.message`.
- **B. `worktree` arg undefined.** Plugin API changed; `worktree` is
  a different name now. Writes fail constraint; silent swallow.
- **C. sqlite import failure or db null.** Either plugin runtime
  isn't Bun, or bun:sqlite is unavailable in plugin context. Handler
  bails at `if (!db) return` with no log surface.
- **D. Something else** — e.g. plugin's own console.warn isn't
  reaching the log file; warnings exist but invisible.

### 12.3 Instrumentation fallback

If static analysis doesn't yield a confident root cause in 45 min:

```ts
// Add at the top of the event handler, just after p destructure:
try {
  (await import("fs")).appendFileSync(
    "/tmp/cost-tracker-debug.log",
    JSON.stringify({
      ts: new Date().toISOString(),
      type: e.type,
      keys: Object.keys(p),
      msgKeys: p.message ? Object.keys(p.message) : null,
      msgId: p.message?.id ?? p.id ?? null,
      sessionID: p.sessionID ?? null,
      worktreePath,
      dbReady: !!db,
    }) + "\n",
  )
} catch {}
```

Restart opencode. Leave running through normal work. Collect
samples after a few prompts. Pattern in the log reveals which
hypothesis is right.

After fix, **delete the diagnostic line**.

### 12.4 Acceptance for Commit 1

```
$ sqlite3 ~/.local/state/opencode-cost.db "SELECT COUNT(*) FROM messages;"
<some N > 0>
$ sqlite3 ~/.local/state/opencode-cost.db "
    SELECT message_id, session_id, worktree_path, model_id,
           cost_opencode_fxp8 FROM messages ORDER BY ts_created DESC LIMIT 3;"
<three real rows with sane values>
$ sqlite3 ~/.local/state/opencode-cost.db "SELECT COUNT(*) FROM session_rollup;"
<at least 1, after a session.idle has fired>
$ sqlite3 ~/.local/state/opencode-cost.db "SELECT COUNT(*) FROM provider_rates;"
<at least 1, after the rate-table fetch settles>
```

Plus: subsequent restarts continue writing; no plugin-load errors in
the opencode log.

---

## 13. Archive + supersession plan (Commit 6)

### 13.1 Files moved

```
docs/plans/opencode-cost-tmux-status/PLAN.md
  → docs/archive/opencode/PLAN-cost-tmux-status-v1.md
    (use `git mv` to record as a rename)

docs/plans/opencode-cost-zen-per-request/PLAN.md
  → docs/archive/opencode/PLAN-cost-zen-per-request.md
    (same)
```

### 13.2 Supersession header (prepend to both)

```markdown
> **Superseded** by
> [docs/plans/opencode-cost-pertask-tmux-status/PLAN.md](../../plans/opencode-cost-pertask-tmux-status/PLAN.md)
> on 2026-05-19.
>
> <one-line summary of why; e.g. "v1 shipped global daily/total
> figures; the per-task pivot consolidated v1, the per-request PLAN,
> and Phase 5 backfill into a single master execution doc.">
>
> Decision history below is preserved as-is for reference.
```

### 13.3 In-place updates to non-archived plans

**`docs/plans/opencode-cost-breakdown/PLAN.md`** — add Progress entry
near the top:

```
- 2026-05-19 — Option A (per toggl project breakdown via worktree
  JOIN) superseded by
  `../opencode-cost-pertask-tmux-status/PLAN.md` §7 (CLI surface
  `opencode-cost dump by-toggl`) and §10 (acceptance tests). This
  PLAN is retained for the Option A vs Option B (per-tmux-session)
  comparison and the open-questions reasoning that informed the
  per-task pivot.
```

**`docs/plans/opencode-cost-tracker/PLAN.md`** — replace the existing
2026-05-19 tmux-status entry with one that points at the master:

```
- 2026-05-19 — per-task tmux status bar + ecosystem rewrite.
  Plugin capture bug fixed; Phase 5 backfill shipped
  (`opencode-cost import-opencode`); per-row Zen integration
  shipped (`zen_usage` table, per-row `zen-sync` rewrite);
  `opencode-cost dump by-toggl` shipped with full §10 acceptance
  tests; bar v2 ships per-task daily/total via the toggl JOIN.
  zen-sync timer cadence now `OnCalendar=*:0/10`. Details in
  `../opencode-cost-pertask-tmux-status/PLAN.md`.
- **Next:** monitor drift between local `cost_opencode_fxp8` and
  Zen-billed `zen_usage.cost_fxp8` via
  `dump reconciliation --by-message` over a week of normal usage.
```

### 13.4 Verification

After Commit 6 lands:

```
$ git -C ~/src/dotfiles ls-files docs/plans docs/archive | grep -E 'cost'
docs/archive/opencode/PLAN-cost-tmux-status-v1.md
docs/archive/opencode/PLAN-cost-zen-per-request.md
docs/plans/opencode-cost-breakdown/PLAN.md
docs/plans/opencode-cost-pertask-tmux-status/PLAN.md
docs/plans/opencode-cost-tracker/PLAN.md
```

---

## 14. Open items / non-goals

1. **Multi-worktree session attribution.** If a real session ever
   shows up with ≥2 distinct `worktree_path`s in `messages` (e.g.
   a session moved across worktrees mid-life, or a subagent
   inheriting from a parent whose worktree changed), design the
   closest-match join then. Likely a window function on `messages`
   ordered by `ABS(strftime('%s', ts_created) - strftime('%s',
   zu.time_created))`, with dump output marking
   `attribution=ambiguous` for transparency. §10.1.e omits this
   case until it shows up in production data.
2. **`cost_recomputed_fxp8` long-term position.** With per-row Zen
   ground truth available, `recompute.ts` becomes diagnostic-only.
   Decision deferred: keep maintaining vs. freeze. Revisit after a
   few months of parallel data shows whether recompute drift
   surfaces real bugs that Zen-vs-TUI drift misses.
3. **`tz_offset` config key vestigial.** Per-row endpoint no longer
   needs tz; leave field in `config.json` for backward compat. Emit
   a runtime warning first time it's read in a process:
   `"tz_offset is deprecated and ignored; remove from
   ~/.config/opencode-cost/config.json"`. No `--help` mention.
4. **Auto-discover `x-server-id`** from the page or a JS bundle —
   eliminates the manual recapture step. Defer until pain becomes
   real.
5. **Page-size constant drift.** Tests §10.6.i and §10.6.j pin
   current behavior in both directions; tighten if drift becomes
   visible.
6. **Multi-workspace.** Schema includes `workspace_id` on every
   `zen_usage` row; sync is keyed by workspace. Switching workspaces
   or running across multiple workspaces in one DB is supported by
   the schema, but queries in §5/§6/§7 omit `WHERE workspace_id = ?`
   because the config carries one workspace today and the DB only
   ever contains rows for it. When a second workspace lands, every
   query needs an explicit filter — track as a single migration
   item. Add a `--workspace <wid>` override at the same time.
7. **HTML SSR fallback** for `_server` outage — defer unless `_server`
   becomes unreliable. ~1 day of work, low priority.
8. **Color thresholding on the bar.** E.g. red text when daily-cost
   crosses $X. Easy to add later; not in this scope.
9. **Per-tmux-session breakdown.** Option B in the breakdown PLAN —
   worse signal than worktree-based attribution, not implemented.
10. **BYOK / mixed-key reconciliation** (Anthropic Admin API, OpenAI
    `/v1/organization/usage`). Out of scope until mixed-BYOK becomes
    a real workflow. Would require a `litellm` proxy or an opencode
    patch to inject metadata on provider requests.

---

## 15. Reference data

### 15.1 Known values (Bamboo / mbh)

```
workspace_id   = wrk_01KQ84M0D0KDDEQSD7E0HYNNWK
key_id         = key_01KQ84M0FJDRT9XX86HVS4D5NN
display        = michael@bamboosoftwarellc.com - Default API Key
```

Page size (empirical): 50 rows / page on `usage.list`.

Sample session IDs (from May 19 capture):

- `ses_1bd83b887ffeMTaTL66PWEPHdA`
- `ses_1bd7b43c4ffe2YC1f1iETlJtIn`
- `ses_1bd77fe22ffet4PIN2Jcp7RGB4`

Format matches opencode's `id.descending("ses")` IDs — direct join to
`messages.session_id`.

### 15.2 Unit math (Zen `totalCost`, sampled 2026-05-18)

| Date       | Model           | Raw totalCost   | USD ($) |
|------------|-----------------|-----------------|---------|
| 2026-05-01 | claude-opus-4-7 | 3,953,540,850   | 39.54   |
| 2026-05-05 | claude-opus-4-7 | 10,341,769,025  | 103.42  |
| 2026-05-06 | claude-opus-4-7 | 30,298,336,900  | 302.98  |
| 2026-05-17 | claude-opus-4-7 | 185,809,275     | 1.86    |
| 2026-05-18 | claude-opus-4-7 | 24,768,547,575  | 247.69  |
| 2026-05-18 | gpt-5-nano      | 33,115          | 0.00033 |

Divisor `1e8` makes every row land on a believable figure. Store as
INTEGER, divide at display.

### 15.3 Recovery runbooks

Cookie expiry, `x-server-id` rotation, and other operational recovery
procedures: see `../opencode-cost-tracker/PLAN.md` §8.

### 15.4 Live system pointers

- DB: `~/.local/state/opencode-cost.db` (WAL)
- Sync lock: `~/.local/state/opencode-cost/zen-sync.lock` (Commit 4)
- Cookie: `~/.config/opencode/secrets/zen-session-cookie` (chmod 600)
- Config: `~/.config/opencode-cost/config.json`
- Timer: `~/.config/systemd/user/opencode-cost-zen-sync.timer`
  (→ `~/.config/opencode/systemd/opencode-cost-zen-sync.timer`,
  symlinked from this repo)
- tmux poll interval: `tmux.conf:77` (`set -g status-interval 5`)
- Bar binary: `~/.config/opencode/bin/opencode-cost-tmux-status`
- CLI binary: `~/.config/opencode/bin/opencode-cost`
- opencode source DB for Phase 5: `~/.local/share/opencode/opencode.db`
- Toggl state: `~/.local/state/toggl/state.db`
