# OpenCode Cost — Zen Per-Request Reconciliation — PLAN.md

> **Superseded** by
> [docs/plans/opencode-cost-pertask-tmux-status/PLAN.md](../../plans/opencode-cost-pertask-tmux-status/PLAN.md)
> on 2026-05-19.
>
> Z0-Z5 + §10 acceptance tests are absorbed verbatim into the master
> PLAN's Commits 3-5 and §10. Z6 (one-time `zen_daily_billed` sanity
> capture) and Z7 ("update other plans") are dropped: Z6 was an
> optional sanity check, and Z7 is the very work that produced the
> master PLAN. The per-row `zen_usage` schema, the `_server`
> pagination loop with `flock` lock, the static `$R[N]` parser, the
> per-message reconcile, and `dump by-toggl` all shipped in the
> consolidated master PLAN.
>
> Decision history below is preserved as-is for reference.

Status: proposal (2026-05-19); revised 2026-05-19 with §10.6/§10.7
acceptance tests and §9 re-ordering; implementation not yet started
Owner: mbh
Origin session: 2026-05-19 — "Does the response payload that we get from
opencode's usage endpoint contain zen session id?"

Supersedes / amends portions of `../opencode-cost-tracker/PLAN.md`:
- §1 problem framing (per-session ground truth is now reachable).
- §2 blind spot #2 (cache TTL collapse) becomes fixable capture-side.
- §3 reconciliation model (per-session, not just per-day).
- §4 architecture (per-row Zen rows replace daily aggregate as primary).
- §6 Phase 4 (request body shape).
- §7 fragility budget (new failure modes added).

Cross-link: `../opencode-cost-breakdown/PLAN.md` — Option A
(toggl-project breakdown) becomes invoice-grade once Z3 lands.

## Progress

- 2026-05-19 — discovered Zen's `_server` `usage.list` function returns
  per-request rows with `sessionID` (matches opencode's `ses_*` IDs),
  per-token-class counts, split cache-TTL fields, and `provider`
  granularity. SSR HTML for `/workspace/<WID>/usage` embeds page 0
  (50 rows) via Solid hydration; subsequent pages come from `_server`
  POST with a 2-arg envelope. Decoded both request/response shapes
  from live captures. Cost-tracker PLAN's §3 "Zen aggregates by
  `(date, model, key, plan)` and does not retain session IDs" was
  describing the 4-arg `f:31` daily-aggregate response — not the
  per-row source we just found. This plan replaces that integration.
- 2026-05-19 — plan drafted; awaiting acceptance test definition
  before implementation begins.
- 2026-05-19 — plan revised in review pass (R1–R13). Locked decisions:
  mid-sync arrivals are accepted as eventual-consistency (R1, §5.2 +
  §11.1); multi-worktree session attribution deferred until a real
  case appears (R3 dropped §10.1.e row, §11.7 captures the rationale);
  workspace scoping deferred to a single migration step in §11.5 (R4);
  `cost_recomputed_fxp8` removed from §6.2 per-message reconcile (R5),
  with §11.8 capturing the freeze-vs-maintain question; §10.6 sync-loop
  and §10.7 parser acceptance tests added (R6/R7) with Z0' and Z3'
  scaffolded ahead of Z3 in §9 (R8); Z6 sanity check moved to a
  one-time captured `__fixtures__/zen-daily-<date>.json` comparison
  (R9); `dump by-toggl` promoted into §7 CLI table (R10);
  `tz_offset` deprecation channel pinned to a runtime warning, no
  `--help` change (R12); §5.3 lock spec'd as `flock(2)` advisory with
  exit code 75 for contention (R13). Sub-cent fixture row (R11) left
  out as optional. Effort estimate updated to ~7.5 h (was ~6 h);
  first useful slice is now Z0+Z0'+Z1+Z3'+Z3 (~4 h).

## 1. Problem

The cost-tracker PLAN concluded that Zen's billing endpoint only
exposed `(date, model, key, plan)` aggregates, so per-session
reconciliation had to come from a local recompute that we could only
cross-check at the daily aggregate level. That conclusion was based on
reverse-engineering one specific `_server` call (4-arg `f:31`) used
for the dashboard's monthly chart.

The Zen dashboard's "Usage History" table at the bottom of the
`/workspace/<WID>/usage` page actually shows per-request rows that
include the opencode session ID. The page server-renders the first
50 rows (via Solid hydration in the HTML) and paginates the rest via
a separate `_server` 2-arg call. This makes per-request reconciliation
against Zen's invoice possible without any local-recompute heuristics.

## 2. What we just learned from the captures

### 2.1 Per-row response (the prize)

Each row in the `usage.list` response (and in the SSR HTML hydration)
has this shape:

```js
{
  id:                "usg_01KS18SCTPTTA8N686PMMV29FJ",  // ULID-ish; unique
  workspaceID:       "wrk_01KQ84M0D0KDDEQSD7E0HYNNWK",
  timeCreated:       new Date("2026-05-19T23:22:58.000Z"),
  timeUpdated:       new Date("2026-05-19T23:22:58.137Z"),
  timeDeleted:       null,
  model:             "claude-opus-4-7",
  provider:          "anthropic",                  // granular: anthropic, azure2, fireworks-go-minimax-m2.5.an
  inputTokens:       1,
  outputTokens:      549,
  reasoningTokens:   null,                          // null for anthropic; 0 for azure2
  cacheReadTokens:   165100,
  cacheWrite5mTokens: 665,                          // null for fireworks
  cacheWrite1hTokens: 0,                            // null for fireworks
  cost:              10043625,                      // fxp8 USD
  keyID:             "key_01KQ84M0FJDRT9XX86HVS4D5NN",
  sessionID:         "ses_1bd83b887ffeMTaTL66PWEPHdA", // opencode session ID, direct join key
  enrichment:        null                           // always null in observed; forward-compat
}
```

Notable: no `plan` field per-row. (The 4-arg daily-aggregate response
has `plan`; we no longer call that endpoint.)

### 2.2 Pagination request shape (`_server` 2-arg)

```
POST https://opencode.ai/_server
Headers:
  content-type: application/json
  cookie: oc_locale=en; auth=Fe26.2*...
  origin: https://opencode.ai
  referer: https://opencode.ai/workspace/<WID>/usage
  x-server-id: <64-char bundle hash, rotates on deploy>
  x-server-instance: server-fn:N    (any N; server echoes back as self.$R["server-fn:N"])
Body:
  {"t":{"t":9,"i":0,"l":2,"a":[
     {"t":1,"s":"<workspaceID>"},
     {"t":0,"s":<page_index>}
   ],"o":0},"f":31,"m":[]}
```

Response: `((self.$R = self.$R || {})["server-fn:N"] = [], ($R => $R[0] = [<50 rows>])($R["server-fn:N"]))`

So `$R[0]` is the array of rows directly. No `{ usage, keys }` wrapper.

### 2.3 SSR HTML embedding

`GET /workspace/<WID>/usage` returns HTML with a `<script>` block
containing Solid hydration. The relevant resource is keyed
`_$HY.r["usage.list[\"<WID>\",0]"]`. The data slot resolves to a
plain JS array identical to the `_server` 2-arg response above.

We are **NOT** going to scrape the HTML. Once the `_server` 2-arg
integration works, page 0 + every other page comes from the same
endpoint. The HTML scrape was tempting but the SSR-vs-CSR boundary
adds a third format to maintain. Drop it.

### 2.4 Pagination behavior

- Page size: 50 rows (counted on both page 0 and page 1).
- Order: newest-first (descending `time_created`).
- Offset-based, **unstable**: new rows arriving between requests shift
  the offset. Captured page 1 included 5 rows newer than page 0's
  newest, plus the top 45 rows that were on page 0.
- `id` is stable; dedup by `id` is mandatory.

### 2.5 Month picker is irrelevant for per-row

Switching the dashboard's month picker triggered the **4-arg `f:31`
daily aggregate** call (the same one our existing
`opencode-cost-tracker/PLAN.md` §6 documented). It did NOT trigger a
per-row refetch. The Usage History table at the bottom of the page
always shows the most-recent N rows regardless of which month the
chart is showing. To get per-row data for an older month, we paginate
`usage.list` backward until we cross the month boundary.

The 4-arg daily-aggregate call is no longer needed for our purposes —
we can derive the same numbers from `SUM(cost_fxp8) GROUP BY date,
model` on `zen_usage`.

### 2.6 Misc

- `f:31` in the body is shared between the 2-arg per-row call and the
  4-arg monthly aggregate. The server appears to dispatch on the arg
  signature, not on a function ID. We just need to send the right
  args.
- `x-server-instance: server-fn:N` is a client-generated request ID;
  the server echoes it back into the response IIFE. Any value works.
- `x-server-id` is a bundle hash; rotates on each Zen deploy. Stays
  in config; covered by existing PLAN §8 recovery runbook.

## 3. Architecture

Three loosely-coupled pieces (same shape as the cost-tracker PLAN,
with the Zen integration rewritten):

1. **Plugin** (`cost-tracker.ts`) — unchanged in role; gains a
   capture-side fix (cache TTL split in `messages`).
2. **CLI** (`opencode-cost`) — `zen-sync` rewritten; new dump
   subcommands; `dump reconciliation` gains `--by-message`.
3. **DB** (`~/.local/state/opencode-cost.db`) — adds `zen_usage`
   (per-request), keeps `zen_daily_billed` as a derived rollup,
   adds split cache columns to `messages`.

## 4. Schema

### 4.1 New: `zen_usage`

```sql
CREATE TABLE zen_usage (
  id                       TEXT PRIMARY KEY,        -- usg_*
  workspace_id             TEXT NOT NULL,
  session_id               TEXT,                    -- ses_*; nullable for legacy
  key_id                   TEXT NOT NULL,
  model                    TEXT NOT NULL,
  provider                 TEXT NOT NULL,
  time_created             TEXT NOT NULL,           -- ISO 8601
  time_updated             TEXT NOT NULL,           -- ISO 8601
  time_deleted             TEXT,                    -- ISO 8601 or null
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

### 4.2 Kept: `zen_daily_billed`

Becomes a derived rollup, rebuilt at the end of each sync:

```sql
INSERT OR REPLACE INTO zen_daily_billed (date, model, key_id, plan, total_cost_fxp8, fetched_at)
SELECT substr(time_created, 1, 10), model, key_id, NULL,
       SUM(cost_fxp8), MAX(fetched_at)
FROM zen_usage
GROUP BY 1, 2, 3;
```

Keeps the existing daily reconcile path working unchanged.

### 4.3 Capture-side change: `messages` cache TTL split

```sql
ALTER TABLE messages ADD COLUMN tokens_cache_write_5m INTEGER;
ALTER TABLE messages ADD COLUMN tokens_cache_write_1h INTEGER;
-- tokens_cache_write keeps living as the sum (backward compat).
```

`plugins/cost-tracker.ts` reads `tokens.cache.write.5m` and
`tokens.cache.write.1h` from opencode's `AssistantMessage` payload
(confirm field names in code) and writes all three (5m, 1h, sum).

Backfill: not needed — the existing `messages` table is empty per
the cost-tracker PLAN's Progress block.

## 5. Sync loop

### 5.1 Per-page fetch

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
  // ...existing chunk-prefix strip + parseServerResponse (with new Date() extension)...
  // ...walk $R[0] (an array) and normalize each row...
  return rows
}
```

### 5.2 Pagination loop with stop conditions

```ts
const PAGE_SIZE = 50  // empirically observed; if a page returns <50 rows it's the last page

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
2. Page with fewer than 50 rows → last page.
3. Incremental mode: all rows in the current page already exist in DB
   (older than `newestKnown`) → we've reached known territory.
4. Safety cap at 1000 pages (50K rows). Tunable.

**Mid-sync arrivals are eventually-consistent.** Rows that arrive after
their would-be page has already been fetched are not retrieved in the
current run. They surface on the next incremental sync because
`MAX(time_created)` advances past them and they're returned at the top
of page 0. Accepted by design — the per-row endpoint is offset-based
and we don't refetch page 0 mid-loop. Documented here so it's not
later misread as a bug. See §11 for the open-item link if drift ever
becomes visible enough to warrant a fix.

### 5.3 Concurrent sync protection

Linux `flock(2)` advisory exclusive lock at
`~/.local/state/opencode-cost/zen-sync.lock` to prevent systemd timer +
manual run from racing. PID and start-time are written into the file
for diagnostics only; `flock` semantics handle stale-process release
automatically when the holder crashes (kernel drops the lock on
process exit). Contending callers exit with code 75 ("retry later")
and a one-line diagnostic that includes the holder's PID/start-time.

## 6. Reconciliation

### 6.1 Daily reconcile (existing, unchanged code path)

`opencode-cost dump reconciliation [--month YYYY-MM]` still reads
`zen_daily_billed`. The table is now populated from `zen_usage` rather
than from a separate Zen API call, but the SQL surface stays the
same. Existing tests/users see no regression.

### 6.2 Per-message reconcile (new)

`opencode-cost dump reconciliation --by-message [--session ses_xxx] [--since YYYY-MM-DD]`

```sql
SELECT
  m.session_id,
  m.ts_created                                    AS local_ts,
  zu.time_created                                 AS zen_ts,
  m.model_id,
  printf('$%.4f', m.cost_opencode_fxp8 / 1e8)     AS tui,
  printf('$%.4f', zu.cost_fxp8 / 1e8)             AS zen,
  printf('$%+.4f', (zu.cost_fxp8 - m.cost_opencode_fxp8) / 1e8) AS drift,
  (m.tokens_input  - zu.input_tokens)             AS input_delta,
  (m.tokens_output - zu.output_tokens)            AS output_delta,
  (m.tokens_cache_read     - zu.cache_read_tokens)      AS cache_read_delta,
  (m.tokens_cache_write_5m - zu.cache_write_5m_tokens)  AS cache_5m_delta,
  (m.tokens_cache_write_1h - zu.cache_write_1h_tokens)  AS cache_1h_delta
FROM messages m
LEFT JOIN zen_usage zu
  ON zu.session_id = m.session_id
  AND zu.model     = m.model_id
  AND ABS(strftime('%s', zu.time_created) - strftime('%s', m.ts_created)) < 5
WHERE m.ts_created >= COALESCE(:since, m.ts_created)
ORDER BY m.ts_created DESC;
```

The 5-second join window absorbs clock skew between opencode's local
capture timestamp and Zen's server-side row timestamp.

`cost_recomputed_fxp8` is intentionally omitted from this view. Now
that Zen ground truth is per-row, `tui vs zen` is the only drift
column that matters operationally. `recompute.ts` and
`messages.cost_recomputed_fxp8` are retained as diagnostics for
capture-side regressions and rate-table staleness; see §11 for the
open question on whether to freeze that code path long-term.

## 7. CLI surfaces

New / changed subcommands:

| Subcommand | Purpose |
|---|---|
| `opencode-cost zen-sync` | Default incremental sync; paginates `usage.list` from page 0 until known territory |
| `opencode-cost zen-sync --full` | Backfill all history; paginates until empty/short page |
| `opencode-cost zen-sync --dry-run` | Fetch + parse + diff against DB, no writes |
| `opencode-cost zen-sync --max-pages N` | Safety cap override |
| `opencode-cost dump zen-usage [--session …] [--since …] [--json\|--csv\|--table]` | Read `zen_usage` directly |
| `opencode-cost dump by-session-zen [--since …]` | Group `zen_usage` by session, output session totals |
| `opencode-cost dump by-toggl --group-by task\|project\|client [--since …] [--until …] [--toggl-db …] [--include-unmapped] [--include-unattributed] [--no-model-split] [--json\|--csv\|--table]` | Roll up `zen_usage` by toggl `(client, project, task)` via the `messages.worktree_path` → `toggl_repo_state` join. Full spec in §10.1.f. |
| `opencode-cost dump reconciliation` (existing) | Unchanged; reads derived `zen_daily_billed` |
| `opencode-cost dump reconciliation --by-message [--session …]` | Per-message join (§6.2) |

## 8. Fragility budget

| Failure mode | Detection | Recovery |
|---|---|---|
| Cookie expires (~Jun 2027) | HTTP 401 / redirect to login | Recapture from DevTools; existing PLAN §8 runbook |
| `x-server-id` rotates on Zen deploy | HTTP 404/500 or unexpected body | Re-scrape from workspace HTML; existing PLAN §8 runbook |
| Page size constant (50) changes | Premature stop or runaway loop | Lower bound the page-size check to e.g. ≥30; warn loud when unexpected |
| Pagination becomes stable / cursor-based | Old loop returns garbage | Body shape mismatch surfaces via parser; bail loud + dump |
| Per-row response shape changes (new fields) | Existing parser drops unknown fields silently | Add diff-detection: hash known field set; warn when new fields appear |
| `new Date(...)` literal replaced with ISO string | Parser regex misses, treats as undefined | Defensive: parser accepts both `new Date("…")` and bare ISO string |
| Schema drift on `enrichment` becoming non-null | Currently a blob | Stored as JSON; surface in `dump zen-usage` with `--show-enrichment` |
| Multi-key BYOK | Currently single key in `keys` array | `key_id` on each row; no special handling needed |
| Concurrent sync runs (timer + manual) | Race on insert | Flock at `~/.local/state/opencode-cost/zen-sync.lock` |

## 9. Implementation order

Tests-before-code for parser and sync loop: Z0' and Z3' write the
test scaffolds (against a not-yet-implemented module) so the
behavioral targets are locked before the corresponding production
code lands.

| # | Step | Effort | Notes |
|---|------|--------|-------|
| Z0  | Parser extension: `new Date("...")` → ISO string | ~30 min | Single new prefix in the value parser |
| Z0' | §10.7 parser acceptance tests scaffolded against the new parser module | ~30 min | Tests fail until Z0 lands; pin the contract |
| Z1  | Schema: add `zen_usage`; keep `zen_daily_billed` as derived rollup | ~45 min | `ALTER TABLE` adds for `messages` cache split |
| Z2  | Capture-side cache TTL split (independent of Zen work) | ~45 min | Lands in parallel with Zen path |
| Z3' | §10.6 sync-loop acceptance tests scaffolded against the new sync module | ~45 min | Tests fail until Z3 lands; mock `_server` |
| Z3  | `_server` 2-arg pagination + sync loop with stop conditions | ~1.5 h | Replaces existing `fetchZenUsage` |
| Z4  | `opencode-cost zen-sync` CLI + flock | ~45 min | `--full`, `--dry-run`, `--max-pages` |
| Z5  | `dump zen-usage`, `dump by-session-zen`, `dump by-toggl`, `dump reconciliation --by-message` | ~1.5 h | Per-message join SQL; toggl rollup SQL |
| Z6  | Aggregate sanity check: per-row SUM matches captured 4-arg `f:31` fixture for one day | ~15 min | One-time DevTools capture saved to `__fixtures__/zen-daily-<date>.json`; assert `SUM(cost_fxp8) GROUP BY date,model` matches. Sample: 2026-05-19 claude-opus-4-7 should equal `9788183150` fxp8 |
| Z7  | PLAN.md amendments to cost-tracker §1/§2/§3/§4/§6/§7; Progress entry to breakdown plan | ~30 min |

Total ~7.5 h. First useful slice: Z0+Z0'+Z1+Z3'+Z3 (~4 h) populates
the DB end-to-end with test coverage. Z2 is independent and can land
in parallel.

## 10. Acceptance tests

This section defines the user-visible behavior the plan must deliver.
Tests are stated as "given X / when Y / then Z" with explicit
invariants so the implementation has unambiguous targets. Acceptance
tests are added incrementally; §10.1 is the first.

### 10.1 Shared fixture for toggl-attribution rollup tests

Tests §10.2, §10.3, and §10.4 share one synthetic fixture and one
join path. This section defines them once. Each test references the
fixture and asserts a specific shape of output.

#### 10.1.a Toggl state

`toggl_repo_state` (in `~/.local/state/toggl/state.db`) contains
exactly:

| `worktree_path`                              | `client_name` | `project_name` | `task`    |
|----------------------------------------------|---------------|----------------|-----------|
| `~/src/bamboo/ccs/kern/BAM-123`              | CCS           | Kern           | `BAM-123` |
| `~/src/bamboo/ccs/adventist/BAM-124`         | CCS           | Adventist      | `BAM-124` |
| `~/src/bamboo/schneller/hardening/SH-987`    | Schneller     | Hardening      | `SH-987`  |

#### 10.1.b Local capture

`messages` contains rows for six opencode sessions (IDs are
placeholders — the test fixture generates them):

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

1. **Sum-up consistency.** Sum of per-task costs for project P ==
   per-`(client_of_P, P)` cost. Sum of per-`(client, project)` costs
   for client C == per-client cost for C. Sum of all per-client costs
   == `SUM(zen_usage.cost_fxp8)` over the window — provided
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
| **Unmapped worktree** — `messages.worktree_path` not in `toggl_repo_state` (fixture row `ses_U1`) | Surfaced as `(unmapped)` bucket. Cost counted, not silently dropped. |
| **Unattributed Zen row** — `zen_usage.session_id` not in `messages` (fixture row `ses_X9`) | Surfaced as `(no-local-capture)` bucket via `LEFT JOIN messages`. Cost counted. |
| **Worktree retargeted via `toggl-set` mid-history** | Current `toggl_repo_state` is authoritative at query time. Historical rollups retroactively reflect new mapping. By design — no history table. |
| **Title-gen / subagent sessions** with same `worktree_path` as parent | Inherit parent's `(client, project, task)` naturally via the join. |
| **`toggl.db` missing** | Rollup query fails with `ATTACH DATABASE … failed: file not found — run \`toggl-set\` in at least one worktree to create it`. Non-zero exit code. |

Multi-worktree sessions (one `session_id` with ≥2 distinct
`worktree_path`s in `messages`) are deliberately out of scope here.
The simple `JOIN messages USING (session_id)` assumes 1-to-1 worktree
attribution. If/when a real session shows up with multiple
worktrees, design the closest-match join then; tracked in §11.

#### 10.1.f Shared CLI surface

Adds `opencode-cost dump by-toggl` (one subcommand, three group-by
modes) — supersedes the SQL sketch in
`../opencode-cost-breakdown/PLAN.md` §A:

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

Sum of `cost_usd` column == `$16.10` (matches §10.1.d invariant 1).

CCS aggregates `ses_A1` ($5.00) + `ses_A2` ($0.10) + `ses_B1` ($3.00)
+ `ses_B2` ($2.00) across two projects.

With `--no-model-split`, the same totals collapse to:

| client              | cost_usd |
|---------------------|----------|
| CCS                 | $10.10   |
| Schneller           | $4.00    |
| (unmapped)          | $1.50    |
| (no-local-capture)  | $0.50    |

### 10.3 Per-project rollup

**Given** the fixture in §10.1.
**When** `opencode-cost dump by-toggl --group-by project` is run with
no time-range filter.
**Then** output MUST contain exactly these rows (sort order:
`cost_usd` descending; ties broken by `(client, project)` ascending):

| client              | project             | model           | cost_usd |
|---------------------|---------------------|-----------------|----------|
| CCS                 | Adventist           | claude-opus-4-7 | $5.00    |
| CCS                 | Kern                | claude-opus-4-7 | $5.00    |
| Schneller           | Hardening           | claude-opus-4-7 | $4.00    |
| (unmapped)          | (unmapped)          | claude-opus-4-7 | $1.50    |
| (no-local-capture)  | (no-local-capture)  | claude-opus-4-7 | $0.50    |
| CCS                 | Kern                | gpt-5-nano      | $0.10    |

Sum of `cost_usd` column == `$16.10`.

CCS / Adventist aggregates `ses_B1` ($3.00) + `ses_B2` ($2.00) — the
test exercises summation across multiple sessions within one task /
project / client bucket.

### 10.4 Per-task rollup

**Given** the fixture in §10.1.
**When** `opencode-cost dump by-toggl --group-by task` is run with no
time-range filter.
**Then** output MUST contain exactly these rows (sort order:
`cost_usd` descending; ties broken by `(client, project, task)`
ascending):

| client              | project             | task                | model           | cost_usd |
|---------------------|---------------------|---------------------|-----------------|----------|
| CCS                 | Adventist           | BAM-124             | claude-opus-4-7 | $5.00    |
| CCS                 | Kern                | BAM-123             | claude-opus-4-7 | $5.00    |
| Schneller           | Hardening           | SH-987              | claude-opus-4-7 | $4.00    |
| (unmapped)          | (unmapped)          | (unmapped)          | claude-opus-4-7 | $1.50    |
| (no-local-capture)  | (no-local-capture)  | (no-local-capture)  | claude-opus-4-7 | $0.50    |
| CCS                 | Kern                | BAM-123             | gpt-5-nano      | $0.10    |

Sum of `cost_usd` column == `$16.10`.

### 10.5 Test fixture implementation

Build a synthetic fixture in `opencode-cost/__tests__/by-toggl.test.ts`
(new) that:

1. Creates an in-memory SQLite for `opencode-cost.db` with `messages`
   and `zen_usage` populated per §10.1.b.
2. Creates an in-memory SQLite for `toggl.db` (attached as `toggl`)
   with the three `toggl_repo_state` rows per §10.1.a.
3. Runs the three rollups (§10.2, §10.3, §10.4), each asserting the
   exact expected output and all four invariants from §10.1.d.
4. Separately exercises each edge case from §10.1.e (unmapped,
   unattributed, retargeted, title-gen, missing `toggl.db`) — at
   least one test per case.

Implementation MUST pass all three rollup tests before §10.2–§10.4
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
| **10.6.l Mid-sync arrivals** | Page 0 returns rows R0..R49. After fetch, 5 new rows R-5..R-1 arrive on the mock. Page 1 returns the simulated post-arrival window. | New rows are NOT picked up this run (eventual-consistency contract per §5.2). They DO appear on a subsequent incremental sync that starts with the updated `newestKnown`. |

Implementation note: the mock `_server` is a small in-process fake
that holds an array of rows and returns slices on `(workspaceId,
page)` requests. Tests script the array contents and `newestKnown`
state up front.

### 10.7 Parser acceptance tests

Scope: §2 seroval-style envelope parsing. **Scaffold before Z0.**

Given a scripted `_server` response body, when the parser runs, then:

| Case | Input | Expected |
|------|-------|----------|
| **10.7.a `new Date("...")`** | Row with `timeCreated: new Date("2026-05-19T23:22:58.000Z")` | Field surfaces as ISO-8601 string `"2026-05-19T23:22:58.000Z"`. |
| **10.7.b Shared `$R[N]` back-refs** | `$R[2]` referenced from two row positions | Parsed graph preserves shared instance equality (one object, two references). |
| **10.7.c Chunked stream prefixes** | Three variants: `;0x<hex>;` at start; between rows; absent | All three produce byte-identical row arrays. |
| **10.7.d Empty `$R[0] = []`** | Server returns the empty-rows envelope | Returns empty array, no error. |
| **10.7.e Missing `$R[0]`** | Server returns a body without the rows slot | Throws loudly with a message pointing at §8 runbook. |
| **10.7.f Shape drift (new field)** | Row has an unexpected top-level field | Decide on first run: surface in `enrichment_json` (forward-compat) or warn-and-drop. Test pins whichever we pick. |
| **10.7.g Numeric edges** | Fields: `0`, negative, float, exponent (`1e8`), `null` for nullable (reasoning, cache_5m/1h for fireworks) | Round-trip exactly. No silent coercion. |
| **10.7.h String escape sequences** | Strings containing `\n`, `\t`, `\"`, `\\` | Decoded correctly; no JSON-vs-JS-literal collision. |
| **10.7.i No `eval` / `Function` escape hatch** | Body contains an IIFE wrapper that would only execute via `eval` | Static parser walks the literal subset; refuses to invoke any JS evaluator. Test inspects the parser's call graph (or, if simpler, monkey-patches `eval`/`Function` and asserts they're never called). |

Implementation note: the parser tests run against in-memory string
fixtures captured from real Zen responses, redacted where needed.
Store them in `opencode-cost/__tests__/__fixtures__/parser/`.

### 10.99 Follow-on test areas (not yet defined)

Subsequent acceptance tests still to be written, in roughly the
order they're likely needed:

- Schema: `zen_usage` integrity (no duplicates by `id`);
  `zen_daily_billed` derived totals match SUM-from-`zen_usage`.
- Capture-side split: `messages.tokens_cache_write` == `_5m + _1h`
  invariant.
- Per-message reconciliation: §6.2 join correctness; clock-skew window
  behavior; session-filtered output.
- CLI: exit codes; `--json`/`--csv`/`--table` output stability; error
  paths (missing cookie, missing config, etc.).
- Fragility: stale `x-server-id` produces a recognizable error
  pointing at the runbook.

## 11. Open items

1. **Boundary cases on the per-row stream.** Two related unknowns,
   both currently handled defensively:
   - *Empty page shape.* Never observed. Best guess is `$R[0]=[]`;
     defensive parser dumps + raises if the shape surprises (test
     §10.7.d locks the empty-rows contract; §10.7.e covers the
     missing-slot case).
   - *Mid-sync arrivals.* Per §5.2, rows that arrive after their
     would-be page has been fetched are caught on the next
     incremental sync, not the current one. Accepted as eventual
     consistency; revisit only if observable drift between Zen
     invoices and `zen_usage` SUM appears.
2. **`tz_offset` config key** becomes vestigial (no longer used).
   Channel: leave the field in `config.json` for backward compat;
   emit a runtime warning the first time it's read in a process
   (`"tz_offset is deprecated and ignored; remove from
   ~/.config/opencode-cost/config.json"`). No `--help` mention.
3. **Auto-discover `x-server-id`** from the page or a JS bundle —
   eliminates the manual recapture step. Defer until pain becomes
   real.
4. **Page-size constant drift** — what if Zen changes 50 → 100? Plan
   says lower-bound to ≥30; tighten if drift becomes visible. Tests
   §10.6.i and §10.6.j pin the current behavior in both directions.
5. **Multi-workspace.** Schema includes `workspace_id` on every row;
   sync is keyed by workspace. Switching workspaces or running across
   multiple workspaces in one DB is supported by the schema, but
   queries in §5/§6/§10 omit `WHERE workspace_id = ?` because
   `~/.config/opencode-cost/config.json` carries one workspace ID
   today and the DB only ever contains rows for it. When a second
   workspace lands, every query needs an explicit filter — track as
   a single migration item, not piecemeal. Add a `--workspace <wid>`
   override at the same time.
6. **HTML SSR fallback** — if `_server` access breaks but the page
   still renders, we could fall back to scraping the hydration payload
   for page 0. Worth ~1 day of work; not pursuing unless the `_server`
   path proves unreliable.
7. **Multi-worktree session attribution.** The toggl rollup in §10
   assumes a single `session_id` maps to one `worktree_path`. If a
   real session ever shows up with ≥2 distinct `worktree_path`s in
   `messages` (e.g. a long-lived session moved across worktrees, or
   a subagent inheriting from a parent whose worktree changed),
   design the closest-match join then — likely a window function on
   `messages` ordered by `ABS(strftime('%s', ts_created) -
   strftime('%s', zu.time_created))`, with the dump output marking
   `attribution=ambiguous` for transparency. Edge case is removed
   from §10.1.e until this happens.
8. **`cost_recomputed_fxp8` long-term position.** With per-row Zen
   ground truth available, the local recompute path
   (`recompute.ts` + `messages.cost_recomputed_fxp8`) becomes
   diagnostic-only — useful for catching capture-side regressions and
   rate-table staleness, but no longer part of any reconciliation
   that ships to a user. Decision deferred: keep maintaining vs.
   freeze and remove from new tooling. Revisit after a few months of
   parallel data shows whether the recompute drift ever surfaces a
   real bug that Zen-vs-TUI drift would have missed.

## 12. Reference: known values (Bamboo / mbh)

```
workspace_id   = wrk_01KQ84M0D0KDDEQSD7E0HYNNWK
key_id         = key_01KQ84M0FJDRT9XX86HVS4D5NN
display        = michael@bamboosoftwarellc.com - Default API Key
```

Page size (empirical): 50 rows / page on `usage.list`.

Observed session IDs in the May 19 sample (for join-key sanity-checks
during implementation):
- `ses_1bd83b887ffeMTaTL66PWEPHdA`
- `ses_1bd7b43c4ffe2YC1f1iETlJtIn`
- `ses_1bd77fe22ffet4PIN2Jcp7RGB4`

Format matches opencode's `id.descending("ses")` IDs — direct join
to `messages.session_id` with no mapping layer.
