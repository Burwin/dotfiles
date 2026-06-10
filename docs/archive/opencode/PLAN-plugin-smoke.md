# PLAN-plugin-smoke: green/red signal across every custom opencode plugin

> **Status:** implemented; archived 2026-06-10.
>
> Implementation lives in:
> - `opencode/.config/opencode/bin/opencode-plugin-smoke` — the runner
>   (Tier 1 parse-checks + Tier 2 `bun:test` + Tier 3 `--live` opencode
>   serve + log scan).
> - `opencode/.config/opencode/plugins/cost-tracker/recompute.test.ts`
>   — Step 1 unit tests for `recompute()`.
> - `opencode/.config/opencode/plugins/cost-tracker/rate-table.test.ts`
>   — Step 2 unit tests for `fetchRates` / `persistSnapshot`.
> - `opencode/.config/opencode/plugins/cost-tracker/cost-tracker.test.ts`
>   — Step 3 parse-checks (`bun build --no-bundle`) + dispatch harness.
> - `README.md` "Tests" section — Step 6 docs update; documents the
>   `opencode-plugin-smoke` and `opencode-plugin-smoke --live` entry
>   points.
> - `docs/plans/opencode-cost-tracker/PLAN.md` §12.3 — Step 6 docs
>   update; closed out the manual grep smoke step in favor of this
>   runner.
>
> Decision history below preserved as-is.

# opencode-plugin-smoke tests

A single `opencode-plugin-smoke` command that gives a green/red signal across
every custom opencode plugin in this user's environment after an opencode
upgrade, organized in four independently-runnable tiers.

In scope:
- `notify.ts` (this repo)
- `cost-tracker.ts` (this repo)
- `toggl-time.ts` (cross-repo: `~/src/bamboo/tools/src/opencode/plugins/`,
  symlinked from `~/.config/opencode/plugins/`)

Out of scope:
- Mutating the production `~/.local/state/opencode-cost.db` or
  `~/.local/state/toggl/state.db`. Tier 2 / Tier 3 use per-test temp paths
  via `OPENCODE_COST_DB` / `TOGGL_STATE_DB`.
- POSTing to live ntfy. `notify.test.ts` already mocks `fetch`; new suites
  follow the same pattern.
- Visual mako toast verification (still manual; flagged as known gap).
- Mutating files in the bamboo-tools repo. The smoke runner invokes that
  repo's bun:test suite when present, but adds no files there.

---

## Progress

- [x] Step 1: `recompute.test.ts` (cheap)
- [x] Step 2: `rate-table.test.ts` (cheap)
- [x] Step 3: `cost-tracker.test.ts` (mid)
- [x] Step 4: `opencode-plugin-smoke` runner — Tier 1 + Tier 2 (cheap–mid)
- [x] Step 5: `--live` tier (Tier 3) in the runner (mid–sota)
- [x] Step 6: docs updates — README + cost-tracker PLAN §12.3 (cheap)

When picking the model for each step, the marked tier is the *floor* — a
SOTA model is always fine, but you don't need SOTA for the cheap steps.

---

## Tier legend

- **cheap** — boilerplate, well-specified algorithm, low risk of subtle
  edge cases. Sonnet-class or smaller can complete autonomously.
- **mid** — async lifecycle, light mocking, multiple files touched in
  one step. A capable mid-tier model handles it; SOTA is helpful but
  not strictly required.
- **sota** — process lifecycle, signal handling, cross-repo path
  detection, race-safe poll loops. Prefer SOTA. A mid model may need
  multiple corrections.

---

## Existing test landscape (snapshot at plan time)

| Plugin | Helper-lib unit tests | Entrypoint parse-check | Dispatch-logic tests | Documented in README |
|---|---|---|---|---|
| `notify.ts` | yes (`notify/notify.test.ts`, ~30 tests) | yes (`bun build --no-bundle`) | partial (helper-lib mapping) | yes |
| `cost-tracker.ts` | none (`recompute.ts` even has a "tests live in ./recompute.test.ts" comment that was never honored) | none | none — the `properties.info` vs `properties.message` SDK shape drift was a silent capture bug exactly because of this gap | no |
| `toggl-time.ts` | yes (`toggl-time.lib.ts` throttle tests) | none directly | yes (`toggl-time.test.ts` drives synthetic events through a real DB; `toggl-time-warn.test.ts` covers the missing-row warning latch) | not in this repo |

Existing single-command surface (today): the README documents
`bun test ./opencode/.config/opencode/plugins/`, which discovers only
`notify/notify.test.ts`.

Cost-tracker PLAN §12.3 documents a manual smoke step
(`grep -i 'cost-tracker' ~/.local/share/opencode/log/*.log | tail` after a
fresh opencode session). Step 6 below replaces that.

---

## Gaps addressed by this plan

1. No `bun build --no-bundle` parse-check for `cost-tracker.ts` or its
   helpers. Single highest-value, lowest-cost smoke against
   `@opencode-ai/plugin` / `@opencode-ai/sdk` type drift.
2. No unit tests for `recompute.ts` (pure function, all edge cases
   already enumerated in source comments).
3. No dispatch-logic tests for `cost-tracker.ts`. The handler reads
   `event.properties.info`; pre-fix code read `properties.message` and
   silently dropped every row. Future SDK shape drift would re-trigger
   that class of bug with zero signal.
4. No single-command runner. README's `bun test ...` line only sees
   notify.
5. No live plugin-load smoke. §12.3 of the cost-tracker PLAN still
   leaves it as a manual grep step.
6. No coverage of `toggl-time.ts` from this repo. Its tests live in
   `~/src/bamboo/tools/` and run from there; a post-opencode-upgrade
   smoke that only covers dotfiles plugins gives a false-green if
   `toggl-time.ts` broke.

---

## Step 1 — `recompute.test.ts`

**Tier: cheap.** Pure function, algorithm fully specified in
`opencode/.config/opencode/plugins/cost-tracker/recompute.ts:16-37`.
No async, no DB, no mocking beyond `console.warn`.

### Files

- ADD: `opencode/.config/opencode/plugins/cost-tracker/recompute.test.ts`

### Spec

Cover every documented edge case in `recompute.ts`:

1. **Happy path, no breakpoint** — `rate.tier_breakpoint` undefined.
   Verify `under = billableInput`, `over = 0`, all multipliers applied,
   `Math.round(cost * 1e8)` returned.
2. **Missing rate** — `recompute(undefined, tokens)` returns 0 and warns
   exactly once across multiple calls (latch behavior). Spy on
   `console.warn`. Note that the latch is module-scoped, so either
   reset the module between tests via `bun:test`'s
   `mock.module` / dynamic import, or accept that the second test
   onwards will not warn and assert that explicitly.
3. **Tier breakpoint splits billable input** — both branches:
   - `billableInput < breakpoint` → `over = 0`, all under-rate.
   - `billableInput > breakpoint` → mixed.
   - `billableInput === breakpoint` → `over = 0` (boundary).
4. **`input_over_tier` absent** — falls back to `rate.input` either
   side of the breakpoint.
5. **`output_over_tier`** — currently *read but unused* in
   `recompute()`. Pin that contract with a test: provide a different
   `output_over_tier` and assert the result still uses `rate.output`
   throughout. A future fix that wires it in will break this test;
   that's intentional, so the change becomes visible.
6. **`cache_write` rate absent** — contributes 0 (the `?? 0` guard).
7. **Reasoning bills as output** — same multiplier.
8. **Floating-point rounding** — choose rates × tokens that produce a
   sub-cent fraction; assert `Math.round(cost * 1e8)` not truncation.

### Verify

```bash
bun test ./opencode/.config/opencode/plugins/cost-tracker/recompute.test.ts
```

All assertions pass. No tests skipped.

### Kickoff message for next step

```
Step 1 of docs/plans/opencode-plugin-smoke/PLAN.md (recompute.test.ts) is
complete and bun test is green. Proceed with Step 2 (rate-table.test.ts).
This step is tier=cheap and can be done by a cheap LLM. Read the Step 2
section of the PLAN for the spec.
```

---

## Step 2 — `rate-table.test.ts`

**Tier: cheap.** Small companion suite for `rate-table.ts`. Light
mocking of the injected `client.config.providers.list()` call; no
async lifecycle beyond a single `await`.

### Files

- ADD: `opencode/.config/opencode/plugins/cost-tracker/rate-table.test.ts`

### Spec

First, read
`opencode/.config/opencode/plugins/cost-tracker/rate-table.ts` to
discover the exact exported surface (`fetchRates`, `persistSnapshot`,
`Rate` type, the `rate_version` derivation). The plan was written
without re-reading this file in full, so the test author should
confirm the actual API before stubbing.

Then test:

1. **`fetchRates(client)` happy path** — stub `client.config.providers.list()`
   to resolve a known synthetic provider snapshot; assert the returned
   `RateTable` has the expected `rates` map keyed by
   `${providerID}/${modelID}` and the expected per-rate fields.
2. **Deterministic `rate_version`** — same input → same `rate_version`
   (likely hash- or content-derived). Different input → different.
3. **`persistSnapshot(db, table)`** — open a `:memory:` `bun:sqlite`
   DB, ensure the snapshot table is created (likely via the same
   bootstrap path as `cost-tracker/db.ts`'s `openDb`), call
   `persistSnapshot`, read back via SQL, assert the row matches.
4. **`fetchRates` failure** — stub the client to reject; assert
   `fetchRates` either rejects or returns an empty table (whichever
   the implementation does). Pin the contract — the consuming code in
   `cost-tracker.ts:91-110` already handles both because of the
   fire-and-forget pattern, but the test should match what the
   function actually does today.

### Verify

```bash
bun test ./opencode/.config/opencode/plugins/cost-tracker/rate-table.test.ts
```

### Kickoff message for next step

```
Step 2 of docs/plans/opencode-plugin-smoke/PLAN.md (rate-table.test.ts)
is complete and bun test is green. Proceed with Step 3
(cost-tracker.test.ts: parse-checks + event-handler dispatch). This step
is tier=mid; prefer a SOTA model, or a capable mid-tier with the PLAN
loaded. Read the Step 3 section of the PLAN for the spec.
```

---

## Step 3 — `cost-tracker.test.ts`

**Tier: mid.** Combines static parse-checks with a synthetic-event
dispatch harness. Touches the SDK shape contract directly. Highest
likelihood of bumping into subtleties:

- Module-level latches (`warnedMissingRate`, `warnedNoDb`) leak across
  tests unless the module is re-imported per test.
- The plugin entrypoint fires a `fetchRates` promise on load and
  returns *before* it resolves. Tests that race against rate-table
  population will see `rateTable.rates = {}` — either await an
  explicit settle point or test the empty-rate code path on purpose.
- `OPENCODE_COST_DB` must be set *before* `cost-tracker/db.ts` is
  evaluated (see `toggl-time.test.ts` for the prior art).

### Files

- ADD: `opencode/.config/opencode/plugins/cost-tracker/cost-tracker.test.ts`

### Spec

Mirror `notify/notify.test.ts`'s structure: a `parses cleanly via bun
build` group, plus the dispatch group.

#### Group A — module parse-checks

Run `spawnSync("bun", ["build", "--target=bun", "--no-bundle", file])`
against each of:

- `../cost-tracker.ts` (entrypoint)
- `./db.ts`
- `./recompute.ts`
- `./rate-table.ts`

Assert `status === 0`; on failure, throw an error containing
`res.stderr` so the test report shows the SDK breakage point.

#### Group B — event-handler dispatch

Setup per test:

```ts
process.env.OPENCODE_COST_DB = join(tempDir, "cost.db")
const { CostTrackerPlugin } = await import("../cost-tracker.ts")
const client = {
  config: { providers: { list: async () => ({ /* stub */ }) } },
  // ...whatever else the plugin touches
}
const hooks = await CostTrackerPlugin({
  worktree: tempWorktree,
  client,
  $: () => Promise.resolve(),  // unused by this plugin; stub to satisfy type
})
```

Then exercise:

1. **`message.updated` with an `AssistantMessage` writes a row.** Build
   a synthetic `info` matching the SDK shape *as documented at the top
   of `cost-tracker.ts:31-46`*:
   ```
   { id, sessionID, role: "assistant", time: { created, completed },
     modelID, providerID, mode, cost, tokens: { input, output,
     reasoning, cache: { read, write } }, finish }
   ```
   After dispatching, open the temp DB with `bun:sqlite` and assert
   the row landed with the expected fields.
2. **User messages are skipped** — `role: "user"` produces no row.
3. **Missing `properties.info` is logged and dropped** — spy on
   `console.warn`; assert no row inserted; assert no throw.
4. **`session.idle` triggers `sessionRollup.computeAndUpsert`** — seed
   two assistant messages first via (1), then fire `session.idle`,
   then read the rollup row and assert sums.
5. **Cache-write tier split**:
   - Numeric `cache.write` → `tokens_cache_write` populated, 5m/1h
     columns NULL.
   - Object `cache.write: { "5m": N, "1h": M }` → 5m/1h columns
     populated, `tokens_cache_write` is the sum.
6. **DB unavailable** — point `OPENCODE_COST_DB` at an unwritable
   path (e.g. `/proc/0/nope`), reload the plugin, fire an event,
   assert the warning fires exactly once across multiple events
   (warn-latch contract).

### SDK shape snapshot

At the top of the test file, paste the *current* shape of the SDK
`AssistantMessage` interface verbatim (from
`~/.config/opencode/node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts`)
with a comment pointing to the file. When the SDK upgrades and the
shape changes, this snapshot will look stale next to the live type —
the test will fail and the comment tells the reader where to look.

### Verify

```bash
bun test ./opencode/.config/opencode/plugins/cost-tracker/cost-tracker.test.ts
# And the whole plugins/ tree should still be green:
bun test ./opencode/.config/opencode/plugins/
```

### Kickoff message for next step

```
Step 3 of docs/plans/opencode-plugin-smoke/PLAN.md (cost-tracker.test.ts)
is complete and bun test for the whole plugins/ tree is green. Proceed
with Step 4 (opencode-plugin-smoke runner — Tier 1 + Tier 2 only; defer
the --live tier to Step 5). This step is tier=cheap-to-mid; a cheap LLM
can do the bash, mid for the cross-repo path detection. Read the Step 4
section of the PLAN for the spec.
```

---

## Step 4 — `opencode-plugin-smoke` runner (Tier 1 + Tier 2)

**Tier: cheap–mid.** Bash. The cross-repo detection adds a little
logic but is greppable; a cheap LLM can complete this, with a
correction-pass to handle edge cases (missing bun, missing toggl-time
symlink, invocation from outside the repo).

### Files

- ADD: `opencode/.config/opencode/bin/opencode-plugin-smoke`
  (executable shell script; symlinked into `~/.config/opencode/bin/`
  by the existing `install.sh` whole-`bin/`-dir link).

### Spec

```
Usage: opencode-plugin-smoke [--tier=N] [--quiet|--verbose]
                             [--toggl-time|--no-toggl-time]
                             [--live]

Default tier: 1,2 (parse-checks + bun:test).
--live promotes to tier=1,2,3 (see Step 5).
--tier=N takes a comma-separated list, e.g. --tier=1 or --tier=1,2.
```

Resolution rules:

1. Locate the dotfiles plugin tree. Two strategies, in order:
   - If invoked from inside the dotfiles repo (detect by walking up
     from the script's realpath looking for `opencode/.config/opencode/plugins/`),
     use that path.
   - Else, resolve `~/.config/opencode/plugins/` and follow the
     symlink target back into the dotfiles repo (the existing layout
     guarantees a symlink — see `install.sh`).
2. Detect `toggl-time.ts`:
   - If `~/.config/opencode/plugins/toggl-time.ts` exists and resolves
     to `~/src/bamboo/tools/src/opencode/plugins/toggl-time.ts`,
     `TOGGL_TIME_DIR` = the realpath of its parent. Else unset and
     skip with a `skipped:` notice unless `--toggl-time` is forced.
   - `--no-toggl-time` forces skip even when present.

Tier 1 (parse-checks) targets:

```
plugins/notify.ts
plugins/notify/lib.ts
plugins/cost-tracker.ts
plugins/cost-tracker/db.ts
plugins/cost-tracker/recompute.ts
plugins/cost-tracker/rate-table.ts
bin/opencode-cost
opencode-cost/by-toggl.ts
opencode-cost/dump.ts
opencode-cost/import-opencode.ts
opencode-cost/reconcile.ts
opencode-cost/zen-sync.ts
# If TOGGL_TIME_DIR is set:
$TOGGL_TIME_DIR/toggl-time.ts
$TOGGL_TIME_DIR/toggl-time.lib.ts
```

For each, run `bun build --target=bun --no-bundle "$file" >/dev/null`
and collect failures.

Tier 2 (bun:test) invocations:

```
bun test ./opencode/.config/opencode/plugins/
# If TOGGL_TIME_DIR is set:
bun test "$TOGGL_TIME_DIR/toggl-time.test.ts" \
         "$TOGGL_TIME_DIR/toggl-time-warn.test.ts"
```

Output format:

```
[tier 1] parse-checks
  ok    plugins/notify.ts
  ok    plugins/notify/lib.ts
  ok    plugins/cost-tracker.ts
  ...
  ok    13 files

[tier 2] bun:test
  ok    plugins/    47 pass, 0 fail
  ok    toggl-time  18 pass, 0 fail
  skip  (or "ok"/"fail" per group as appropriate)

smoke: pass (tier=1,2 / 3 plugins / 65 tests)
```

Exit code: 0 iff all selected tiers pass. Non-zero indicates the
worst-failing tier's status. `--quiet` reduces to the final summary
line.

### Behavior on missing `bun`

If `command -v bun` fails, exit 2 with a clear message — this is a
config error, not a smoke failure.

### Verify

```bash
# After symlink (install.sh re-run is unnecessary because bin/ is
# already a whole-directory symlink), the binary is on PATH:
opencode-plugin-smoke           # tier=1,2
opencode-plugin-smoke --tier=1  # parse-checks only
opencode-plugin-smoke --quiet   # final summary line only
```

All three should exit 0.

### Kickoff message for next step

```
Step 4 of docs/plans/opencode-plugin-smoke/PLAN.md (opencode-plugin-smoke
runner, tier 1+2 only) is complete; `opencode-plugin-smoke` exits 0 on
this machine. Proceed with Step 5 (--live tier / opencode serve + log
scan). This step is tier=mid-to-sota; prefer a SOTA model — the process
lifecycle and log-polling are error-prone. Read the Step 5 section of
the PLAN for the spec.
```

---

## Step 5 — `--live` tier (Tier 3)

**Tier: mid–sota.** Process lifecycle, race-safe log polling, signal
handling. Prefer SOTA. A mid-tier model can do it but expect multiple
correction passes — especially around backgrounding, port-0
allocation, and cleanup on early-exit.

### Files

- EDIT: `opencode/.config/opencode/bin/opencode-plugin-smoke`
  (extend with the `--live` / `--tier=3` arm)

### Spec

Sequence when `--tier` includes 3 (i.e. `--live` was passed):

1. **Preconditions.** Bail out with a clear "skipped, tier 3 disabled"
   message (exit 0 for that tier — *not* a failure) if any of:
   - `command -v opencode` fails.
   - The provider auth file (`~/.local/share/opencode/auth.json`) is
     missing or empty. Tier 3 doesn't need a model round-trip, but
     opencode's startup may bail if auth is missing entirely; better
     to skip than false-fail.
2. **Sandbox the plugin state writes** so the live spawn cannot mutate
   real user state:
   ```bash
   export OPENCODE_COST_DB=$(mktemp -t opencode-cost-smoke.XXXXXX.db)
   export TOGGL_STATE_DB=$(mktemp -t toggl-state-smoke.XXXXXX.db)
   export OPENCODE_IDLE_NTFY_TOPIC=     # disable ntfy fanout entirely
   ```
   Track these temp paths and `rm -f` them in a trap on EXIT.
3. **Spawn `opencode serve`**:
   ```bash
   opencode serve --hostname 127.0.0.1 --port 0 --log-level INFO \
                  > /tmp/opencode-smoke.stdout 2>&1 &
   SMOKE_PID=$!
   ```
   Track `SMOKE_PID` in a trap to `kill -TERM $SMOKE_PID` on EXIT
   (with a `kill -KILL` fallback after 2 s).
4. **Wait for ready.** Two complementary signals:
   - The newest log file in `~/.local/share/opencode/log/` (resolve
     by mtime *after* `SMOKE_PID` is alive — never before, or you
     may pick up a previous run).
   - In that log, the line `service=server status=started`.
   Poll with a deadline (`SMOKE_LIVE_TIMEOUT_SEC`, default 10).
   Implement as a loop with `sleep 0.2` between checks; abort with
   non-zero if the deadline lapses.
5. **Assertions on the log:**
   - **Loaded** — log contains one
     `service=plugin path=file:///home/.../cost-tracker.ts loading plugin`
     line per expected plugin. Allow paths that resolve through
     `~/.config/opencode/plugins/` symlinks.
   - **No errors** — `rg -n '^ERROR\b.*service=plugin'` returns no
     matches; also no `service=plugin.*panic|exception|failed to
     load` lines. (Use `rg -F` for the literal sub-strings, or `rg`
     with anchored patterns; whichever the host has — prefer `rg`,
     fall back to `grep -E`.)
6. **Teardown.** `kill -TERM $SMOKE_PID`, wait up to 2 s for it to
   exit, then `kill -KILL` if necessary. Remove the temp DB files via
   the EXIT trap. The trap must run on every exit path (success,
   failure, signal).

### Concurrency safety

`opencode serve --port 0` lets the kernel pick a free port, so the
live spawn cannot collide with a long-running TUI in another
terminal. The live spawn *will* write a new log file in
`~/.local/share/opencode/log/` — that's fine; opencode keeps every
session's log indefinitely already.

### Output addition

```
[tier 3] live opencode serve
  ok    server started in 1.2s on 127.0.0.1:45611
  ok    cost-tracker.ts loaded
  ok    notify.ts loaded
  ok    toggl-time.ts loaded
  ok    no plugin errors in log
  ok    teardown clean (pid 42891 exited 0)

smoke: pass (tier=1,2,3 / 3 plugins / 65 tests + live load)
```

### Verify

```bash
opencode-plugin-smoke --live
echo $?     # expect 0
```

Re-run twice in quick succession to confirm cleanup leaves no stray
`opencode serve` processes (`pgrep -f 'opencode serve'`).

### Kickoff message for next step

```
Step 5 of docs/plans/opencode-plugin-smoke/PLAN.md (--live tier) is
complete; `opencode-plugin-smoke --live` exits 0 and leaves no stray
processes. Proceed with Step 6 (docs updates — README + cost-tracker
PLAN §12.3). This step is tier=cheap. Read the Step 6 section of the
PLAN for the spec.
```

---

## Step 6 — docs updates

**Tier: cheap.** Two small markdown edits.

### Files

- EDIT: `README.md`
- EDIT: `docs/plans/opencode-cost-tracker/PLAN.md` (§12.3 only)

### Spec

#### `README.md`

Replace the existing "Tests" section's single `bun test ...` line with:

```markdown
## Tests

Smoke test for the custom opencode plugins (`notify.ts`,
`cost-tracker.ts`, and `toggl-time.ts` when present). Static
parse-checks + unit/dispatch suites:

```bash
opencode-plugin-smoke
```

Add `--live` to also spawn a transient `opencode serve` and verify
every plugin loads without error. The live tier sandboxes plugin DB
writes to temp files; your real `~/.local/state/opencode-cost.db` is
untouched.

```bash
opencode-plugin-smoke --live
```

Underlying `bun test` invocation still works directly:

```bash
bun test ./opencode/.config/opencode/plugins/
```
```

#### `docs/plans/opencode-cost-tracker/PLAN.md` §12.3

Replace the PENDING block at lines ~890-898 (verify line range before
editing) with a closed-out variant that points to the runner:

```markdown
### 12.3 Plugin smoke test (CLOSED — covered by opencode-plugin-smoke)

The §12.3 manual grep step is superseded by `opencode-plugin-smoke
--live` (see `docs/plans/opencode-plugin-smoke/PLAN.md`). Run it after
every opencode upgrade.
```

Also adjust the Progress block at the top of the PLAN file (around
lines 4-16) so the smoke-test pending marker is removed.

### Verify

```bash
# README renders sanely:
glow README.md   # or: bat README.md
# Cost-tracker PLAN no longer says "smoke test still pending":
rg -n 'smoke test still pending' docs/plans/opencode-cost-tracker/PLAN.md
# expect: no matches
```

### Kickoff message for next step

```
Step 6 of docs/plans/opencode-plugin-smoke/PLAN.md (docs updates) is
complete. The plan is fully implemented. Optionally run
`opencode-plugin-smoke --live` once more end-to-end to confirm; commit
the work with one commit per step per the workflow rules in
~/.config/opencode/rules/workflow.md.
```

---

## Notes & risks

- **Module-level latches** in `recompute.ts` (`warnedMissingRate`) and
  `cost-tracker.ts` (`warnedNoDb`) leak across tests within a single
  Bun process unless the test resets them or re-imports the module.
  `bun:test`'s `mock.module` API or a dynamic-import-per-test pattern
  is the standard workaround; see how `toggl-time-warn.test.ts`
  re-constructs the plugin instance per test for prior art.
- **`fetchRates` race in the entrypoint.** `cost-tracker.ts:78-110`
  intentionally does *not* await the rate-table fetch on plugin load.
  Dispatch tests that fire `message.updated` immediately after
  `CostTrackerPlugin(...)` resolves will see an empty rate table.
  Either await a settle point (e.g. a `setImmediate` cycle plus the
  mocked promise resolution) or write the test to expect the
  empty-rate path on purpose.
- **`bun build --no-bundle`** is fast (<200 ms per file) but it does
  load the SDK package's type definitions; if `~/.config/opencode/node_modules/`
  is missing or stale, parse-checks will fail with `Cannot find
  module '@opencode-ai/plugin'`. The runner should either run
  `(cd ~/.config/opencode && bun install)` automatically before
  Tier 1 (cheap) or detect-and-error with that hint (cheaper still).
  Recommendation: detect-and-error in the first iteration; auto-fix
  later if it becomes annoying.
- **Tier 3 false-positives on log scan.** opencode's log format is
  not a stable API. If a future version changes the
  `service=plugin path=...` line, the loaded-check regex will silently
  pass even when nothing loaded. Mitigation: also assert that the
  expected number of `loading plugin` lines is present (e.g. ≥3 in
  the default config). Add this as a comment in Step 5's source so a
  future reader knows the trap.
- **`opencode-plugin-smoke` runs in any cwd.** Tier 2's
  `bun test ./opencode/.config/opencode/plugins/` is a relative path
  and only works from the dotfiles repo root. The script must `cd`
  into the resolved dotfiles repo root before invoking it, then
  restore cwd before returning (so `--live` reads the right `~/.local/share/opencode/log/`).
- **Asana MCP and OpenCode upgrade order.** This plan does not cover
  the Asana MCP OAuth flow (`opencode mcp logout asana && opencode mcp
  auth asana`) which is a separate concern; mention in README if a
  user wants the full post-upgrade procedure documented.

---

## Implementation order recap

1. Step 1 — cheap — `recompute.test.ts`
2. Step 2 — cheap — `rate-table.test.ts`
3. Step 3 — mid — `cost-tracker.test.ts`
4. Step 4 — cheap–mid — `opencode-plugin-smoke` (Tier 1 + 2)
5. Step 5 — mid–sota — extend runner with `--live` (Tier 3)
6. Step 6 — cheap — docs updates (README, cost-tracker PLAN §12.3)

Each step is independently shippable. Tier 1+2 alone closes the worst
gap (parse-checks + unit tests for `cost-tracker.ts`). Tier 3 is the
nice-to-have that closes the long-pending §12.3 manual step.
