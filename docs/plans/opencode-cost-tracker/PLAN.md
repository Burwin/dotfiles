# OpenCode Cost Tracking Accuracy — PLAN.md

Status: locked, not yet implemented
Owner: mbh
Origin session: `ses_<example-session-id-4>` (2026-05-18) — "Inaccurate
spend vs billing; Opencode API/MCP session tracking?"

---

## Driver-tier hints (documentation-only)

Each phase below carries a tier tag (`cheap` / `mid` / `sota`) describing how
much model horsepower the implementer should reach for. These are **hints for
human readers**, not consumed by any executor. Drop or relabel freely if a
real driver protocol arrives later.

| Tier  | Use when                                                     |
| ----- | ------------------------------------------------------------ |
| cheap | Pattern-match against existing code; boilerplate.            |
| mid   | Real arithmetic / edge cases / multi-file refactor.          |
| sota  | Novel reverse-engineering; multi-layer fragility decisions.  |

---

## 1. Problem

The TUI's "spent" number disagrees with the actual Zen invoice. The user is
billed in nondollars by Zen (one Zen deci-nanodollar = $1e-8 USD) but opencode
displays a locally-computed estimate. We want a number we can trust:

- Per session — how much did this work cost?
- Per day, per model — does our recompute match Zen's billing? If not, where
  is the drift?

We cannot reach per-session ground truth — Zen aggregates by `(date, model,
key, plan)` and does not retain session IDs on its side. The best achievable
target is therefore:

- **Per-session: recomputed estimate using opencode's own rate table**
  (close to invoice-grade because the same token counts opencode receives are
  the counts Zen bills against).
- **Per-day-per-model: invoice-grade**, pulled from Zen's internal
  `_server` server-function endpoint.

When the recompute aggregate disagrees with Zen's daily totals, we know there
is an attribution bug (missed messages, dropped events, stale rates) and can
fix it.

---

## 2. Why the TUI cost is inaccurate

The TUI multiplies token counts from each `AssistantMessage` by static rates
in `models.json`. Concrete blind spots that explain the observable drift:

1. **Tier crossings.** Sonnet 4 / 4.5 at 200K, GPT-5.4 / 5.5 at 272K, Gemini
   3.1 Pro at 200K. opencode has `experimentalOver200K` flags per model but
   not every entry uses them, and the local calc doesn't always split tokens
   correctly at the boundary.
2. **Cache TTL collapse.** Anthropic charges 1.25× input for 5-minute cache
   writes and 2× for 1-hour cache writes. opencode collapses both into one
   `cache.write` rate, so 1-hour writes are under-priced.
3. **Pricing table drift.** `models.json` ships with opencode releases.
   Provider price changes land in Zen's table before they land in opencode.
4. **Subagents** (explore, general) run as child sessions. Their cost is
   captured by opencode but the per-session display does not always roll
   children into the parent.
5. **Title generation** uses `small_model` (Claude Haiku 3.5 in this config).
   Those calls bill against the same Zen balance but live in a sibling
   session — easy to miss when summing "this session's cost."
6. **Compaction** generates its own assistant message. The cost is real and
   bills correctly, but the parent session display may hide it.
7. **Errored / aborted messages** still consume input tokens. opencode's
   `cost` field may be 0 or partial in those cases.
8. **Provider-managed tools** (Anthropic web search, file search) bill
   separately. opencode only sees the token usage line, not the tool
   surcharge.
9. **Rounding.** opencode sums per-message; providers reconcile per-request
   line items.

So `AssistantMessage.cost` is a **token-derived estimate**, not the invoice.
Closing the gap requires (a) doing the math correctly and (b) reconciling
against the provider's billed-dollar table.

---

## 3. Reconciliation model

```
                  per session (opencode plugin)         per day (Zen)
                  ┌─────────────────────────────┐       ┌──────────────┐
session-A         │ sum tokens × rates           │       │              │
session-B         │ sum tokens × rates           │  ──►  │ daily total  │
session-C         │ sum tokens × rates           │       │ per model    │
                  └─────────────────────────────┘       └──────────────┘
                          plugin aggregates              Zen authoritative
                          by (date, model)
                          ─────────────────────────────────────────────────
                                   compare → drift column
```

- **Per-session cost** lives in our plugin's recompute. Best estimate;
  cannot be checked against Zen at this granularity.
- **Daily per-model billed cost** comes from Zen. Lets us check that the
  recompute is accurate **in aggregate**.
- If the aggregate matches, per-session numbers are trustworthy. If it
  diverges, there is a bug somewhere; the `raw_json` column lets us replay
  the recompute against historical messages once the bug is fixed.

---

## 4. Architecture

Three loosely-coupled pieces:

1. **Plugin** (`cost-tracker.ts`) — captures every `AssistantMessage` via
   `message.updated`, writes raw tokens + opencode's `cost` + our recompute
   to a local SQLite DB. Style mirrors `notify.ts` (file layout) and the
   bamboo `toggl-time.ts` (defensive event handling, dynamic
   `bun:sqlite` import, best-effort error swallowing).

2. **CLI** (`opencode-cost`) — Bun-shebanged dispatcher. Subcommands:
   - `dump messages | sessions [--since YYYY-MM-DD] [--json|--csv]`
   - `zen-sync [--month YYYY-MM]` — pull daily per-model totals from Zen
   - `dump reconciliation [--month YYYY-MM]` — daily join of recompute vs
     Zen vs TUI

3. **DB** (`~/.local/state/opencode-cost.db`, WAL) — independent of
   opencode's own `opencode.db`. We never write to or schema-couple with
   opencode's store.

### File layout

```
dotfiles/opencode/.config/opencode/
├── plugins/
│   ├── notify.ts                              (existing)
│   ├── notify/                                 (existing)
│   ├── cost-tracker.ts                        (new — plugin entry)
│   └── cost-tracker/
│       ├── db.ts                               (schema, prepared stmts)
│       ├── rate-table.ts                       (/config/providers fetcher)
│       └── recompute.ts                        (tier-aware cost math)
├── bin/
│   └── opencode-cost                           (Bun-shebanged CLI)
└── opencode-cost/
    ├── dump.ts                                  (dump subcommand)
    ├── zen-sync.ts                              (_server fetcher + parser)
    └── reconcile.ts                             (daily-join SQL)

~/.local/state/opencode-cost.db                  (SQLite WAL)
~/.config/opencode-cost/config.json              (workspace_id, key_id, tz)
~/.config/opencode/secrets/zen-session-cookie    (0600, plaintext)
```

PATH for `opencode-cost`: `environment.d/.config/environment.d/path.conf`
already prepends `~/.local/bin`. We add `~/.config/opencode/bin` after it
so the CLI is discoverable from non-interactive shells too.

---

## 5. Schema

All dollar amounts stored as `INTEGER` in fxp8 (USD × 10⁸ — same unit Zen's
`_server` endpoint returns). Avoids float drift. Divide by `1e8` at display
time only.

```sql
PRAGMA journal_mode=WAL;

-- One row per assistant message observed.
CREATE TABLE messages (
  message_id            TEXT PRIMARY KEY,
  session_id            TEXT NOT NULL,
  worktree_path         TEXT NOT NULL,
  provider_id           TEXT NOT NULL,
  model_id              TEXT NOT NULL,
  agent                 TEXT,
  ts_created            TEXT NOT NULL,
  ts_completed          TEXT,
  tokens_input          INTEGER NOT NULL,
  tokens_output         INTEGER NOT NULL,
  tokens_reasoning      INTEGER NOT NULL,
  tokens_cache_read     INTEGER NOT NULL,
  tokens_cache_write    INTEGER NOT NULL,
  cost_opencode_fxp8    INTEGER NOT NULL,    -- AssistantMessage.cost * 1e8
  cost_recomputed_fxp8  INTEGER NOT NULL,    -- our tier-aware recompute
  rate_version          TEXT NOT NULL,        -- sha256 of /config/providers
  finish                TEXT,
  raw_json              TEXT                  -- replay on rate/math fixes
);
CREATE INDEX idx_messages_session ON messages(session_id, ts_created);
CREATE INDEX idx_messages_day     ON messages(substr(ts_created, 1, 10), model_id);

-- Snapshot of session-end totals; written on session.idle.
CREATE TABLE session_rollup (
  session_id                  TEXT PRIMARY KEY,
  ts_last_idle                TEXT NOT NULL,
  total_cost_opencode_fxp8    INTEGER NOT NULL,
  total_cost_recomputed_fxp8  INTEGER NOT NULL,
  message_count               INTEGER NOT NULL
);

-- Zen daily per-model totals, written by `opencode-cost zen-sync`.
CREATE TABLE zen_daily_billed (
  date             TEXT NOT NULL,
  model            TEXT NOT NULL,
  key_id           TEXT NOT NULL,
  plan             TEXT,
  total_cost_fxp8  INTEGER NOT NULL,
  fetched_at       TEXT NOT NULL,
  PRIMARY KEY (date, model, key_id)
);

-- Snapshot of opencode's rate table at capture time. Lets us re-run
-- recompute against historical messages without rate drift contaminating
-- the comparison.
CREATE TABLE provider_rates (
  rate_version  TEXT PRIMARY KEY,             -- sha256 of normalized payload
  fetched_at    TEXT NOT NULL,
  payload_json  TEXT NOT NULL                 -- full /config/providers body
);
```

Idempotency: `INSERT OR REPLACE` on `messages` keyed by `message_id`.
`message.updated` fires multiple times per message during streaming; the
plugin always writes the latest snapshot. `session_rollup` is written once
on `session.idle` (also `INSERT OR REPLACE`).

---

## 6. Phases

| #  | Scope                                                  | Tier  | Effort  | Output                                           |
| -- | ------------------------------------------------------ | ----- | ------- | ------------------------------------------------ |
| 1  | Plugin capture (`messages` from `message.updated`)     | cheap | 1 eve   | DB fills on next opencode run                    |
| 2  | Plugin recompute (rate fetch + tier math + rollup)     | mid   | 1 eve   | `cost_recomputed_fxp8` reflects correct math     |
| 3  | CLI dump (`dump messages|sessions`)                    | cheap | ½ eve   | Query via standard tools (`jq`, `sqlite3`)       |
| 4  | `zen-sync` + `dump reconciliation`                     | sota  | ~3 h    | Daily ground-truth join                          |
| 5  | `import-opencode` historical backfill                  | mid   | ~1 h    | Reconcile prior weeks                            |

### Phase 1 — Plugin capture (cheap)

Files:
- `plugins/cost-tracker.ts` — entry; subscribes to `message.updated`,
  `session.idle`, `session.compacted`, `session.created`.
- `plugins/cost-tracker/db.ts` — schema bootstrap, prepared statements.

Behavior:
- On `message.updated`: extract `tokens.{input, output, reasoning,
  cache.read, cache.write}`, `cost`, `modelID`, `providerID`, `agent`,
  `sessionID`, `id`, timestamps, `finish`. UPSERT into `messages`. Store
  raw JSON for replay.
- On `session.idle`: aggregate the session's rows, UPSERT
  `session_rollup`.
- On every event: defensive cast of `event.properties` to permissive
  shape; switch with explicit `default:` arm for forward-compat (mirrors
  `toggl-time.ts`).
- Bun runtime assumed; dynamic-import `bun:sqlite` inside try/catch so
  Node-host degrades to silent no-op.
- All SQL operations try/caught — plugin is best-effort, must never
  bring the runtime down.

Verification:
- Open an opencode session; send a single prompt; observe one row in
  `messages` and one in `session_rollup` after the turn finishes.

### Phase 2 — Recompute math (mid)

Files:
- `plugins/cost-tracker/rate-table.ts` — fetches `GET /config/providers`
  from the local opencode HTTP server (port comes from the plugin's
  `client` SDK instance, no `--port` pinning needed). Caches one rate
  snapshot per plugin lifetime; persists to `provider_rates`.
- `plugins/cost-tracker/recompute.ts` — pure cost math.

Algorithm:

```
fn recompute(rate, tokens):
  let billable_input = tokens.input + tokens.cache_read
  let over = max(0, billable_input - rate.tier_breakpoint)   // 0 if no breakpoint
  let under = billable_input - over

  cost  = under * rate.input
  cost += over  * rate.input_over_tier
  cost += tokens.output     * rate.output
  cost += tokens.reasoning  * rate.output        // billed as output
  cost += tokens.cache_read * rate.cache_read
  cost += tokens.cache_write * (rate.cache_write ?? 0)
  return cost
```

Per-session rollup walks `session.children` (parent/child relationships
in the opencode session graph) so subagent costs surface in the parent
total. `small_model` (title-gen) attribution is heuristic: model_id
matches the `small_model` config AND the session was created within N
seconds of a parent session start.

Verification:
- Run a long session that crosses the 200K Sonnet boundary; confirm the
  recomputed cost differs from `cost_opencode` on the over-tier rows.
- Run a session that triggers a subagent (`@explore`); confirm the
  parent's rollup includes the child.

### Phase 3 — Minimal CLI (cheap)

Files:
- `bin/opencode-cost` — Bun shebang, subcommand dispatcher.
- `opencode-cost/dump.ts` — `dump messages` and `dump sessions`.

CLI surface:

```
opencode-cost dump messages [--since YYYY-MM-DD] [--json|--csv]
opencode-cost dump sessions [--since YYYY-MM-DD] [--json|--csv]
```

That's the whole API. No fancy aggregation in the CLI — the DB is the
interface, query it with whatever you want (`sqlite3`, `datasette`,
`jq`).

### Phase 4 — Zen reconciliation (sota)

Files:
- `opencode-cost/zen-sync.ts` — implements `opencode-cost zen-sync`.
- `opencode-cost/reconcile.ts` — implements `opencode-cost dump
  reconciliation`.

Request shape (captured 2026-05-18 from Zen dashboard's workspace usage
page):

```
POST https://opencode.ai/_server
Headers:
  content-type: application/json
  cookie: oc_locale=en; auth=<iron-sealed-from-auth.json-or-DevTools>
  origin: https://opencode.ai
  referer: https://opencode.ai/workspace/<WID>/usage
  x-server-id: <manifest-hash; rotates on Zen deploys>
  x-server-instance: server-fn:0
Body (JSON):
  {"t":{"t":9,"i":0,"l":4,"a":[
       {"t":1,"s":"<workspace_id>"},
       {"t":0,"s":<year>},
       {"t":0,"s":<month_0_indexed>},
       {"t":1,"s":"<tz_offset_like_-04:00>"}
     ],"o":0},
   "f":31,"m":[]}
```

Body decoding: TanStack-Start serializer. `t:0`=number, `t:1`=string,
`t:9`=object-with-positional-args. The request encodes
`(workspaceId, year, month0indexed, tzOffset)`. `f:31` is the function
ID in the server-function manifest. The function index `server-fn:0`
matches the index inside the manifest.

Response: chunked-stream with hex chunk prefix (`;0xNNNNN;`). Body
builds a `$R[n]` slot-graph object using IIFE:

```js
((self.$R = self.$R || {})["server-fn:0"] = [],
 ($R => $R[0] = { usage: $R[1] = [...] , keys: $R[28] = [...] })($R["server-fn:0"]))
```

Decoded shape:

```ts
{
  usage: Array<{
    date: string         // "YYYY-MM-DD"
    model: string        // "claude-opus-4-7", "gpt-5-nano", ...
    totalCost: number    // fxp8 USD (×1e-8)
    keyId: string
    plan: string | null  // null = pay-as-you-go
  }>
  keys: Array<{ id: string; displayName: string; deleted: boolean }>
}
```

Parser: **static-parse the `$R[n]` graph**, do NOT use `node:vm` to eval
the IIFE. Rationale: avoid executing remote JS on the user's host (low
real-world risk over TLS but principled), and a hand-rolled parser is
~50 lines and trivially debuggable when the shape changes. Strip the
`;0xHEX;` chunk prefix; concatenate chunks if the body is multi-chunk;
extract each `$R[N] = ...` assignment via regex; resolve `$R[N]`
back-references; walk to `$R[0].usage`.

Flow (`opencode-cost zen-sync`):

1. Read cookie from `~/.config/opencode/secrets/zen-session-cookie`.
2. Optionally scrape the current `x-server-id` from the HTML at
   `https://opencode.ai/workspace/<WID>/usage` (the page embeds it).
   Fallback: hardcoded `current` value in `~/.config/opencode-cost/
   config.json`, plus a clear failure mode that says "server-id
   rotated, re-scrape or paste a fresh curl."
3. POST to `/_server` with the body above for the current month (or
   `--month YYYY-MM` for backfill).
4. Strip the `;0x<hex>;` chunked-stream prefix.
5. Static-parse the `$R[n]` graph; extract the `usage` array.
6. UPSERT into `zen_daily_billed` keyed on `(date, model, key_id)`.

`opencode-cost dump reconciliation [--month YYYY-MM]` columns:

```
date | model | recomputed_$ | tui_$ | zen_billed_$ | recompute_delta_$ | tui_delta_$
```

### Phase 5 — Historical backfill (mid)

File:
- `opencode-cost/zen-sync.ts` gains an `import-opencode` subcommand (or
  a sibling file; not blocking).

Read `~/.local/share/opencode/opencode.db` read-only; extract all
`AssistantMessage` rows from the `part` table (`json_extract(data, '$.type')
= 'step-finish'` carries the cost/token snapshot per documented opencode
internals — verify on first implementation); insert into our `messages`
with `cost_recomputed_fxp8` computed at backfill time. Schema-coupling to
opencode's store is tolerated defensively (try/catch around every query;
no transactions across versions).

---

## 7. Fragility budget (Phase 4)

| Failure mode                              | Detection                       | Recovery                                                                   |
| ----------------------------------------- | ------------------------------- | -------------------------------------------------------------------------- |
| Cookie expires (~Jun 2027)                | HTTP 401 / redirect to login    | Recapture from DevTools (~30s); document in CLI `--help`                   |
| `x-server-id` rotates on Zen deploy       | HTTP 404/500 or unexpected body | Re-scrape from workspace HTML; fall back to `--server-id <hash>` flag      |
| Function index 0 shifts                   | Wrong-shape response            | Re-scrape function manifest from JS bundle; `--fn-index <n>` override flag |
| `$R[n]` serializer format changes         | Parse failure                   | Dump raw body to `~/.local/state/opencode-cost/last-error.json`; bail loud |
| Cookie file missing / unreadable          | ENOENT / EACCES                 | Print exact recapture instructions                                         |
| Multi-chunk response                      | Hex prefix appears more than 1× | Parser concatenates chunks; covered in implementation                      |

Time-box Phase 4 to ~3 hours. If it explodes, drop to "Phase 2 recompute
only" and the CLI is still useful — the aggregate-vs-Zen check just goes
manual until we revisit.

---

## 8. Recovery runbooks

### Re-capture Zen session cookie

1. Open `https://opencode.ai/workspace/wrk_<your-workspace-id>/usage`
   in your browser (already authenticated).
2. DevTools → Network tab → filter `Fetch/XHR` → refresh page.
3. Find the `POST /_server` request.
4. Right-click → Copy → Copy as cURL.
5. Extract the `auth=Fe26.2*...` segment from the `-b` flag.
6. Write to `~/.config/opencode/secrets/zen-session-cookie`:

   ```bash
   echo 'auth=Fe26.2*...' > ~/.config/opencode/secrets/zen-session-cookie
   chmod 600 ~/.config/opencode/secrets/zen-session-cookie
   ```

7. `opencode-cost zen-sync` should now succeed.

### Re-scrape `x-server-id` after a Zen deploy

Either:

```bash
curl -s 'https://opencode.ai/workspace/<WID>/usage' \
  -b "$(cat ~/.config/opencode/secrets/zen-session-cookie)" \
  | grep -oP 'x-server-id="?\K[a-f0-9]{64}' | head -1
```

…or open DevTools and read it from any `_server` request. Then write
to `~/.config/opencode-cost/config.json`:

```json
{
  "workspace_id": "wrk_<your-workspace-id>",
  "key_id":       "key_<your-key-id>",
  "tz_offset":    "-04:00",
  "server_id":    "<new 64-char hash>"
}
```

---

## 9. Reference data

### Workspace + key (hardcoded; single-workspace, single-key user)

```
workspace_id = wrk_<your-workspace-id>
key_id       = key_<your-key-id>
display      = me@example.com - Default API Key
tz_offset    = -04:00
```

### Unit math (Zen `totalCost`, sampled 2026-05-18)

| Date       | Model           | Raw totalCost   | USD ($) |
| ---------- | --------------- | --------------- | ------- |
| 2026-05-01 | claude-opus-4-7 | 3,953,540,850   | 39.54   |
| 2026-05-05 | claude-opus-4-7 | 10,341,769,025  | 103.42  |
| 2026-05-06 | claude-opus-4-7 | 30,298,336,900  | 302.98  |
| 2026-05-17 | claude-opus-4-7 | 185,809,275     | 1.86    |
| 2026-05-18 | claude-opus-4-7 | 24,768,547,575  | 247.69  |
| 2026-05-18 | gpt-5-nano      | 33,115          | 0.00033 |

Divisor `1e8` makes every row land on a believable figure and divides
cleanly for published Zen rates (opus output $25/M = 2500 per token at
fxp8, input $5/M = 500, cache read $0.50/M = 50). Store as INTEGER,
divide at display.

### Per-token fxp8 rates (sanity check, from current Zen pricing)

```
claude-opus-4-7
  input:        500     (= $5/M  × 1e8 / 1e6)
  output:      2500     (= $25/M × 1e8 / 1e6)
  cache_read:    50     (= $0.50/M)
  cache_write:  625     (= $6.25/M, 5min)

gpt-5-nano
  input:         5      (= $0.05/M)
  output:       40      (= $0.40/M)
  cache_read:    0.5    (= $0.005/M)
```

(gpt-5-nano cache_read at 0.5 per token is the only sub-integer; store
in floating-point only at the per-token rate level, then round to
integer at the per-message total.)

---

## 10. Open items (none blocking)

- After a week of data, surface "TUI vs recompute" drift — probably the
  most interesting column.
- Phase 4 may bear no fruit. Time-box to 2 hours; fall back to recompute
  only if it gets hostile.
- BYOK Anthropic / OpenAI reconciliation (Anthropic Admin API,
  OpenAI `/v1/organization/usage`) is out of scope unless mixed BYOK
  becomes a real workflow. Would require either a `litellm` proxy or
  an opencode patch to inject metadata headers on provider requests
  (no "before HTTP request" hook today).

---

## 11. Implementation order

1. Land this PLAN.md + the stubs (this commit).
2. **Activate** (see §12) — symlink the tree and reload PATH. Required
   before any phase below runs.
3. Phase 1 (capture) — fills the DB on next opencode run.
4. Phase 2 (recompute) — math correctness.
5. Phase 3 (dump CLI) — query ergonomics.
6. Phase 4 (zen-sync + reconciliation) — daily ground-truth join.
7. Phase 5 (backfill) — reconcile prior weeks if needed.

Each phase is independently shippable; Phase 1+2 give immediate value
even if Phase 4 never lands.

---

## 12. Activation (run once after the stubs land)

These are one-time setup steps that bridge "stubs committed" → "Phase 1
implementation can start." They are not part of any phase because they
operate outside the repo (symlinks in `~/.config/`, the systemd user
environment).

### 12.1 Symlink the tree

Run the dotfiles `opencode/install.sh`. It picks up the four new
`FILES` entries (`plugins/cost-tracker.ts`, `plugins/cost-tracker`,
`bin`, `opencode-cost`) and creates symlinks under `~/.config/opencode/`.
Idempotent — safe to re-run when adding more plugin files.

```bash
./opencode/install.sh
```

Verify:

```bash
ls -la ~/.config/opencode/plugins/cost-tracker* \
       ~/.config/opencode/bin \
       ~/.config/opencode/opencode-cost
```

All four entries should be symlinks back into the dotfiles repo.

### 12.2 Reload PATH

`environment.d/.config/environment.d/path.conf` now prepends
`~/.config/opencode/bin`. systemd-environment-generators read that file
on user-session start, so the new entry is picked up automatically on
next login. To activate in the current session without logging out:

```bash
systemctl --user import-environment PATH
systemctl --user daemon-reload
```

…then start a fresh terminal (the running shell keeps the old PATH).
Verify:

```bash
which opencode-cost          # → ~/.config/opencode/bin/opencode-cost
opencode-cost --help         # prints the usage stub
```

### 12.3 Plugin smoke test

The stub plugin loads but no-ops. Confirm opencode picks it up cleanly
by running a single-prompt session and checking opencode's log doesn't
contain a plugin-load error:

```bash
grep -i 'cost-tracker' ~/.local/share/opencode/log/*.log | tail
```

If the log mentions cost-tracker only via the import line (no
`ERROR`/`failed`/`exception`), Phase 1 implementation can start.

### 12.4 Pre-Phase-4 prerequisites (defer until Phase 4 starts)

These don't block Phase 1–3, but Phase 4 is dead-in-the-water without
them:

- **Capture the Zen session cookie.** Open
  `https://opencode.ai/workspace/wrk_<your-workspace-id>/usage`
  in your browser → DevTools → Network → any `_server` request →
  Copy as cURL → extract the `auth=Fe26.2*...` portion → write to
  `~/.config/opencode/secrets/zen-session-cookie` with `chmod 600`.
  Full runbook in §8.
- **Capture the current `x-server-id`.** Same request; copy the
  header value. Write `~/.config/opencode-cost/config.json` per the
  template in §8.
