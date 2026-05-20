# OpenCode Cost Breakdown — PLAN.md

Status: proposal (no work started; needs design decision before
implementation)
Owner: mbh
Origin session: 2026-05-19 — "show me a breakdown of usage cost per
toggl project? Is it easier per tmux session?"

Sibling plan: `../opencode-cost-tracker/PLAN.md` (the underlying
cost-tracker that captures the raw rows this plan slices).

## Progress

- 2026-05-19 — proposal drafted. Surveyed what dimensions
  `~/.local/state/opencode-cost.db` actually captures, the toggl-time
  plugin's repo→project mapping, and the gap re: tmux. No code
  changes yet — waiting on mbh to pick a direction.
- 2026-05-19 — Option A (per toggl project breakdown via worktree
  JOIN) superseded by
  `../opencode-cost-pertask-tmux-status/PLAN.md` §7 (CLI surface
  `opencode-cost dump by-toggl`) and §10 (acceptance tests). This
  PLAN is retained for the Option A vs Option B (per-tmux-session)
  comparison and the open-questions reasoning that informed the
  per-task pivot.

## Problem

`opencode-cost dump messages` / `dump sessions` slice spend by model
and time. Useful for "did we cross a budget", less useful for "where
did the money go" when "where" means a customer, project, or unit of
work. The two most natural axes mbh asked about:

1. **Per toggl project** — same dimension Bamboo bills by. Closest
   thing to invoice-grade attribution.
2. **Per tmux session** — proxy for "what I was working on", in case
   the toggl mapping is missing or fuzzy.

This plan compares both, plus a couple of other dimensions worth
mentioning.

## What's already captured

### `messages` (per-call rows; cost-tracker plugin writes these)

```
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
  cost_opencode_fxp8    INTEGER NOT NULL,
  cost_recomputed_fxp8  INTEGER NOT NULL,
  rate_version          TEXT NOT NULL,
  finish                TEXT,
  raw_json              TEXT
);
```

Available dimensions: `session_id`, `worktree_path`, `provider_id`,
`model_id`, `agent`, time. **Not** there: toggl project, tmux session,
human-facing repo/customer name.

### `zen_daily_billed` (invoice-grade daily totals)

`date × model × key_id × plan`. Zero session-level info. Useful for
totals; useless for slicing by anything below "the whole machine for
one day".

### Current data state (2026-05-19)

- `messages` — **0 rows**. The plugin loaded from a dead
  `MASTER-1703` symlink for every session since the worktree was
  removed; the symlinks under `~/.config/opencode/` were
  re-pointed to `~/src/dotfiles/opencode/.config/opencode/` by
  re-running `opencode/install.sh` in this same session. No code
  commit was needed — the install script was already correct;
  it just hadn't been re-run since the worktree was deleted. The
  next opencode session you start will be the first to populate
  this table.
- `session_rollup` — 0 rows (same root cause; populated alongside
  `messages`).
- `provider_rates` — 0 rows (same root cause).
- `zen_daily_billed` — 30 rows, refreshed hourly by
  `opencode-cost-zen-sync.timer`.

So any per-call breakdown is gated on "run at least one opencode
session, end-to-end, and verify the plugin actually wrote a row".
That's a smoke-test todo for the cost-tracker plan, not this one.

## Option A — Per toggl project (via worktree JOIN)

### Why this is the cheap one

The toggl-time plugin
(`~/src/bamboo/tools/src/opencode/plugins/toggl-time.ts:155`) already
maintains a per-worktree mapping in toggl.db:

```
CREATE TABLE toggl_repo_state (
  worktree_path TEXT PRIMARY KEY,
  project_id    INTEGER,
  project_name  TEXT,
  client_name   TEXT,
  task          TEXT,
  ...
);
```

And `messages.worktree_path` is already captured. So the breakdown
is a JOIN — no new capture, no schema change.

### SQL sketch

```sql
ATTACH DATABASE '<path-to-toggl.db>' AS toggl;

SELECT
  COALESCE(r.client_name,  '(unmapped)') AS client,
  COALESCE(r.project_name, '(unmapped)') AS project,
  COUNT(*)                               AS messages,
  printf('$%.4f', SUM(m.cost_recomputed_fxp8) / 1e8) AS recomputed,
  printf('$%.4f', SUM(m.cost_opencode_fxp8)   / 1e8) AS opencode
FROM messages m
LEFT JOIN toggl.toggl_repo_state r
  ON r.worktree_path = m.worktree_path
WHERE substr(m.ts_created, 1, 10) >= :since
GROUP BY client, project
ORDER BY SUM(m.cost_recomputed_fxp8) DESC;
```

### Caveats

- **Path canonicalization must agree.** `messages.worktree_path` is
  whatever `cost-tracker.ts` writes; `toggl_repo_state.worktree_path`
  is whatever `toggl-time.ts` writes. Both *should* be
  realpath-resolved (see `toggl-time.ts:282`), but the cost-tracker
  fix from the parent plan (Progress entry "realpathSync API
  mismatch") is recent. Worth a one-time `SELECT DISTINCT` sanity
  check on each side before relying on the JOIN.
- **Unmapped worktrees.** Anything not in `toggl_repo_state` falls
  into `(unmapped)`. Quick `toggl-set` in the worktree fixes it
  going forward; doesn't backfill historical rows. Acceptable
  trade-off — it just means past dev/exploration time without a
  toggl mapping is bucketed as "unmapped" rather than mis-attributed.
- **Shared worktrees across projects.** Rare in Bamboo's
  one-worktree-per-task convention, but possible (e.g.
  `~/src/bamboo/tools` for cross-cutting work). The mapping is
  per-worktree, so all messages from that dir go to whatever single
  project is set there. Live with it or split into per-task
  worktrees.

### Surfaces

Pick one, or both:

1. **Ad-hoc SQL**, no new CLI surface. Cheapest. Document the
   query in this PLAN and call it done; mbh runs it on demand.
2. **New `opencode-cost dump by-project` subcommand.** Mirrors the
   existing `dump messages`/`dump sessions` shape. Adds:
   - `--since YYYY-MM-DD` (already a convention)
   - `--toggl-db <path>` (override the default
     `~/.local/state/toggl.db` if it lives elsewhere)
   - `--json` / `--csv` / `--table` outputs
   - Same fxp8-without-divide-by-1e8 contract as the other dumps
     for the JSON/CSV variants; aligned dollars for `--table`.

   Cost: ~half a day. Lives in `opencode-cost/by-project.ts`,
   dispatched from `bin/opencode-cost`.

## Option B — Per tmux session (needs new capture)

### Why this is more work

Nothing in `messages` (or anywhere else) knows about tmux. To
attribute a message to a tmux session you need:

1. **Capture-side change** in `plugins/cost-tracker.ts`. At
   `message.updated` time, read tmux context from the env. The
   relevant signals:
   - `$TMUX` — present iff running under tmux.
   - `$TMUX_PANE` — `%N` pane id.
   - `tmux display-message -p '#{session_name}'` — friendly name.

   Doing this from the plugin runtime requires either spawning
   `tmux` (gross — adds dependency, latency, and a process per
   message) or relying on env vars passed at opencode startup. The
   second is the only sane option, which means the captured tmux
   info reflects *the session opencode was launched in*, not where
   it is at the moment of the message. Window/pane swaps don't
   re-attribute.
2. **Schema migration** — add `tmux_session TEXT` (and maybe
   `tmux_pane TEXT`) to `messages`. Plain `ALTER TABLE … ADD
   COLUMN`; the existing rows would be NULL, which is fine because
   there are none.
3. **New CLI surface** — `opencode-cost dump by-tmux` or similar.
   Same shape as Option A's subcommand.

### Caveats

- **Not retroactive.** Like Option A's mapping, only sessions
  launched after the plugin update get tmux info. Unlike Option A,
  there's no equivalent of "run toggl-set later to backfill" — past
  rows stay NULL forever (or you re-derive them via heuristics on
  `worktree_path`, which is what Option A already does better).
- **Noisier signal.** Tmux session names drift; people rename
  sessions, swap windows mid-task, run opencode in scratch panes.
  Two sessions called `dotfiles` on different days might be
  different work. Two sessions called `MASTER-1703` and
  `cost-breakdown` from the same worktree might be the same work.
- **No external source of truth** to validate against, unlike
  toggl-project which has actual billing rows.

### Verdict

It's doable but it's a worse signal than worktree-based attribution
and costs real plugin work. Probably not worth doing unless toggl
mapping turns out to be unusable in practice (it shouldn't).

## Other dimensions worth a mention

These are free-ish (no new capture) and might be useful enough that
they're worth surfacing alongside or instead of toggl-project:

- **`worktree_path` itself**, no JOIN. Useful when the toggl mapping
  isn't set up yet; reads as `~/src/bamboo/<customer>/<repo>/<task>`
  which is already pretty readable.
- **`agent`** — primary vs. subagent (general/explore). Tells you
  how much spend goes to sub-task delegation. Helpful for
  understanding tool-cost dynamics.
- **`session_id`** — gives you per-conversation cost. Already
  surfaced by `dump sessions`, but the existing version doesn't
  show which conversation went where (just the GID).

A future `dump by-project` could include `agent` as a secondary
grouping with no extra work.

## Open questions for mbh

1. **Surface preference.** Ad-hoc SQL (write the query into this
   PLAN as the deliverable) vs. dedicated `opencode-cost dump
   by-project` subcommand? The former is ~10 minutes; the latter
   is ~half a day but matches the other dump surfaces.
2. **Toggl DB path.** Where does `toggl.db` actually live? The
   PLAN here assumes `~/.local/state/toggl.db` based on the
   toggl-time plugin's comment style, but it should be confirmed
   before any code references it.
3. **Tmux capture: skip or include?** If skip, this plan ships as
   Option A only and we close the question. If include, we need
   a separate decision on whether tmux dims worth the schema bump
   even given the "captured at launch only" limitation.
4. **Backfill story.** Do we care about historical attribution?
   The honest answer is "we can't" — the `messages` table is
   empty for everything before the symlink fix, and even after,
   Option A only attributes worktrees that have a `toggl_repo_state`
   entry. If mbh wants per-project totals going back, the only
   data source is Zen (no session info) — so realistically,
   per-project tracking starts the day this ships.
5. **Daily total reconciliation.** Once per-project numbers exist,
   should the existing `dump reconciliation` subcommand also break
   out the per-project recomputed totals on the local side, so we
   can see (Zen daily total) vs (sum of per-project totals)?
   Probably yes — it makes the unmapped bucket immediately
   visible. Trivial extension.

## If we pick Option A — implementation sketch

Roughly half a day. Phases:

1. **Sanity check the JOIN key.** Once the cost-tracker plugin
   captures real rows: `SELECT DISTINCT worktree_path FROM
   messages` and compare against `SELECT DISTINCT worktree_path
   FROM toggl_repo_state` (after ATTACHing toggl.db). Look for
   trailing-slash / symlink-vs-realpath drift.
2. **Add `opencode-cost/by-project.ts`** — exports
   `runByProject(argv)`. Same arg parser as `dump.ts`. ATTACHes
   toggl.db; runs the SQL above; emits json/csv/table.
3. **Wire into `bin/opencode-cost`** as `dump by-project`. Update
   the help string.
4. **Update `dump reconciliation`** to also bucket the recomputed
   side by project (optional; see open question 5). The Zen side
   stays project-less because it has no session info.
5. **Document** in this PLAN's Progress block and in the
   cost-tracker PLAN's "Future" section.

No systemd-side changes — the timer just keeps `zen_daily_billed`
fresh; the breakdown is read-only on the local DB.

## If we pick Option B — implementation sketch

About a day, plus follow-on uncertainty.

1. Pick capture strategy: env-vars-at-launch (recommended) vs.
   `tmux display-message` shell-out (rejected — adds dep + latency).
2. Schema: `ALTER TABLE messages ADD COLUMN tmux_session TEXT;`
   (and `tmux_pane TEXT` if useful). Add to `BOOTSTRAP_SQL` in
   `plugins/cost-tracker/db.ts` so fresh DBs match.
3. Capture-side: read `process.env.TMUX_PANE` and a derived session
   name in `cost-tracker.ts` plugin init; write to every row.
4. CLI surface: `opencode-cost dump by-tmux`. Same shape as Option
   A's subcommand.
5. Documentation about the "captured at launch, not at message
   time" semantics.

Not recommending this path; included for completeness.

## My recommendation

Option A only. The data dimension is already free; the only real
cost is deciding between ad-hoc SQL and a new dump subcommand.
Skip Option B unless and until toggl-project attribution turns out
to be insufficient in practice.

Tmux session as a dimension is a worse signal than the toggl
mapping already provides via worktree, and the capture has fiddly
semantics that don't match the way a tmux session is actually used.
