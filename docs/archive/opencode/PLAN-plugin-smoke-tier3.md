# PLAN — opencode-plugin-smoke tier-3 re-baseline for opencode 1.17.3

> **Archived 2026-06-23.** Implemented and committed the same day as
> `f299a8c`
> (`fix(opencode): re-baseline plugin-smoke tier-3 for opencode 1.17.3`).
> Tier-3 now spawns `opencode serve --print-logs` and scans the captured
> process stream instead of hunting a log file. **Step 0's capture
> overturned this plan's central assumption:** opencode 1.17.3 emits **no**
> structured per-plugin load line at INFO *or* DEBUG, and only
> cost-tracker announces itself on stdout. So Step 2's "re-baseline the
> per-plugin load regex" became a two-signal design (chosen fork: no
> plugin edits) — a cost-tracker **load canary** (positive tripwire +
> format-change guard) plus an **error scan** matching
> `message="failed to load plugin"` (the genuine, non-vacuous init-throw
> signal; notify/toggl-time are covered by tier 1 + that error scan). The
> same commit also fixed a pre-existing `recompute.test.ts` cross-file
> warn-latch pollution that was making tier 2 red under `bun test <dir>`.
> Verified: `opencode-plugin-smoke --live` exits 0, stays green under a
> concurrent serve, and both deliberate-reds (init-throw → error scan,
> missing plugin → canary) fire. Implementation:
> `opencode/.config/opencode/bin/opencode-plugin-smoke`. Asana:
> MASTER-1808. Decision history below preserved as-is (including the
> original "NOT STARTED" note, now superseded).

> **Status (2026-06-23, NOT STARTED):** scope-refresh of Asana
> **MASTER-1808**
> ([task](https://app.asana.com/1/1203819684139908/project/1204506183888935/task/1215868340672575)).
> This plan supersedes the "Fix options" in the ticket description — the
> ticket captures only one of (at least) two breakages. Background:
> `docs/archive/opencode/PLAN-plugin-smoke.md` (the original, shipped
> 2026-06-10). Implementation has **not** begun.

## TL;DR

`opencode-plugin-smoke --live` tier-3 is red. The ticket blames a single
cause (a rolling `opencode.log` defeats the new-log-file detection). That
is real, but it is **half the problem**: opencode moved **1.14.28 →
1.17.3** and the structured **log format also changed**, so every tier-3
*content* assertion (plugin-loaded check, count guard, error scan) is
written against a format opencode no longer emits. Fixing only the
file-detection step would convert today's honest failure into a **silent
false-PASS** on the error scan — the exact trap the original plan warned
about (`docs/archive/opencode/PLAN-plugin-smoke.md:676-682`).

Recommended fix is also **better than either option in the ticket**: spawn
`opencode serve --print-logs`, which routes the serve process's own logs
to stderr (already captured by the script), then re-baseline the regexes
to the 1.17.3 format. This removes the file hunt *and* the
shared-log concurrency hazard in one move.

---

## Problem — two independent breakages

Both were introduced by the opencode **1.14.28 → 1.17.3** upgrade. The
script's comments and version note (`…/bin/opencode-plugin-smoke:625`) still
reference 1.14.28.

### Breakage 1 — log *location* (the ticket's stated bug)

`run_tier3` snapshots log *filenames* before spawning `opencode serve`,
then expects a brand-new timestamped file to appear and scans that
(`opencode/.config/opencode/bin/opencode-plugin-smoke:521-616`). opencode
1.17.3 instead appends to a single rolling
`~/.local/share/opencode/log/opencode.log`, so the before/after filename
set-diff is always empty → tier-3 dies at `:611` with
`no new log file in …`.

**Evidence (this machine, 2026-06-23):**

- `~/.local/share/opencode/log/` — newest *timestamped* file is
  `2026-06-10T204233.log`; a single `opencode.log` (~85 MB) is actively
  written today.

### Breakage 2 — log *format* (NOT in the ticket)

The structured log format changed, so even once we locate the right log
text, the content regexes mismatch:

| Check | Script pattern (1.14.28) | 1.17.3 reality | Outcome |
| --- | --- | --- | --- |
| Plugin loaded (`:634`) | `service=plugin path=file://…/X.ts loading plugin` | `timestamp=…Z level=INFO run=<id> message=… …` | no match |
| Count guard (`:665`) | `service=plugin path=file://… loading plugin` | `service=plugin` effectively absent | finds 0 |
| Error scan (`:689`,`:694`) | `^ERROR.*service=plugin` / `service=plugin.*(panic\|exception\|failed to load)` | errors are `level=ERROR …` (bare `^ERROR` count = **0** in 85 MB) | **never matches → vacuous PASS** |

**Evidence — same event, two formats:**

```
# OLD (timestamped file, ≤2026-06-10):
INFO  2026-06-10T18:11:24 +0ms service=plugin path=file:///home/mbh/.config/opencode/plugins/cost-tracker.ts loading plugin

# NEW (opencode.log, 1.17.3):
timestamp=2026-06-10T20:54:13.191Z level=INFO run=23d8558e message=loading path=/home/mbh/.config/opencode/config.json
timestamp=2026-06-11T15:47:25.107Z level=ERROR run=76957d62 message=process … error=Aborted stack=undefined
```

> The exact 1.17.3 **plugin-load** line is not present in existing logs
> (the rolling file holds TUI sessions, not a `serve` plugin-load event).
> It must be captured from a real `serve` run — see Step 0. **Do not
> guess the regex.**

### Why the ticket's "option B" is now unsafe

The ticket's second fix option ("snapshot opencode.log's byte length and
scan only the appended tail") is **concurrency-unsafe** under the rolling
file: every concurrent opencode instance (including the agent session
running this very work) appends to the same `opencode.log`. The appended
tail would interleave other instances' plugin loads/errors →
false-PASS (someone else's load satisfies the regex) or false-FAIL
(someone else's plugin error lands in the window). The original script
already fretted about a parallel TUI "winning" the mtime race
(`…/bin/opencode-plugin-smoke:456-459`); one shared file makes that worse.

---

## Recommended approach

1. **Isolate the serve process's logs with `--print-logs`.** `opencode
   serve --print-logs` prints that process's structured logs to stderr.
   The script already redirects the spawn's stdout+stderr to
   `$TIER3_STDOUT` (`…/bin/opencode-plugin-smoke:541`). Scan **that
   captured stream** instead of hunting a file. This kills Breakage 1 (no
   file to find) and the concurrency hazard (process-isolated stream) at
   once — strictly better than the ticket's option B.
2. **Re-baseline the content regexes** (loaded / count / error) to the
   1.17.3 `key=value` format, derived from a captured real log (Step 0),
   preserving each check's *intent*.
3. **Confirm the readiness signal.** Readiness is detected by grepping
   stdout for `opencode server listening on http://`
   (`…/bin/opencode-plugin-smoke:560`). Verify 1.17.3 still emits that
   string and whether `--print-logs` moves it to stderr or rewords it;
   adapt the pattern if Step 0 shows drift.

Tiers 1 (parse) and 2 (`bun:test`) are unaffected and remain trustworthy;
do not touch them.

---

## Implementation order

Each step below is small; Step 0 is **blocking** — everything else
depends on its captured output.

### Step 0 — Capture a real 1.17.3 serve log (blocking, do first)

Sandbox exactly as tier-3 does, then capture both streams:

```bash
OPENCODE_COST_DB=$(mktemp -t oc-cost.XXXXXX.db) \
TOGGL_STATE_DB=$(mktemp -t oc-toggl.XXXXXX.db) \
OPENCODE_IDLE_NTFY_TOPIC= \
  opencode serve --print-logs --hostname 127.0.0.1 --port 0 --log-level INFO \
  >/tmp/oc-smoke-step0.out 2>&1 &
pid=$!
# wait for the listening line, then trigger lazy plugin load:
#   curl -sS "http://127.0.0.1:<port>/config/providers" -o /dev/null
# then: kill -TERM $pid
```

Record from `/tmp/oc-smoke-step0.out`:

- **(a)** exact readiness line + which stream it's on (and whether
  `--print-logs` changes it).
- **(b)** exact plugin-load line(s) for `cost-tracker`, `notify`, and (if
  symlink present) `toggl-time` — field names, path shape, event token.
- **(c)** exact shape of a plugin error line (`level=ERROR …`); decide the
  field(s) that scope an error to a plugin now that `service=plugin` is
  gone.

If plugin-load lines are absent at INFO, retry with `--log-level DEBUG`
before falling back to `run=<id>` filtering of the rolling file.

### Step 1 — Switch the scan source to the captured stream

- Add `--print-logs` to the spawn (`…/bin/opencode-plugin-smoke:540-541`).
- Delete the pre-log filename snapshot and the new-file search
  (`:521-533`, `:592-616`) and their trap bookkeeping
  (`TIER3_PRE_LOGS`); point the scan at `$TIER3_STDOUT`.
- Keep readiness detection; update its pattern only if Step 0 shows drift.

### Step 2 — Re-baseline the content assertions to 1.17.3

Translate, preserving intent, using Step 0's real strings:

- **Loaded check** (`:634`) → match the new per-plugin load line.
- **Count guard** (`:665`) → still assert ≥ `${#expected[@]}` load lines;
  this is the defense against a silently-changed per-line regex
  (`docs/archive/opencode/PLAN-plugin-smoke.md:676-682`).
- **Error scan** (`:689`,`:694`) → match `level=ERROR` (not `^ERROR`) plus
  the plugin-scoping field from Step 0(c); keep the
  `panic|exception|failed to load` substring pass.

### Step 3 — Refresh stale comments

- Header deviation note (`:445-476`) and format comment (`:625-626`) — bump
  to 1.17.3, describe the `--print-logs` stream-scan, drop the
  filename-diff rationale.
- README entry points are unchanged; only touch README if Step 1/2 alter
  flags or behavior a user would see.

### Step 4 — Verify

```bash
opencode-plugin-smoke --live; echo $?        # expect 0
opencode-plugin-smoke --live                 # run twice; then:
pgrep -f 'opencode serve'                     # expect: no stray procs
```

- **Isolation:** run `--live` while a normal opencode TUI is active in
  another terminal; tier-3 must still pass (proves stream isolation).
- **Deliberate red (critical):** temporarily point one expected plugin at
  a missing/renamed file and confirm tier-3 goes **red**. This is the
  guard against re-introducing a false-green — the failure mode that
  motivated this whole plan.

---

## Open questions (with recommended defaults)

1. **Scope — narrow vs. complete?** → **Complete re-baseline** (location +
   format + error scan). The narrow fix alone yields a false-green error
   scan, worse than the current honest failure.
2. **Isolation mechanism?** → **`serve --print-logs`, scan
   `$TIER3_STDOUT`.** Avoid the ticket's byte-offset tail of the shared
   `opencode.log` (concurrency-unsafe). `run=<id>` filtering is the
   fallback only if `--print-logs` lacks the plugin lines.
3. **Readiness line unchanged in 1.17.3?** → **Verify in Step 0;** keep the
   stdout grep if unchanged, else adapt to the structured line.
4. **Exact 1.17.3 plugin-load / error line format?** → **Derive from Step
   0's capture — do not guess.**
5. **Minor: `Status` custom field is null while the task is IN PROGRESS.**
   → set Status → In Progress for consistency (low priority; cosmetic).

---

## Notes & risks

- **False-green is the headline risk**, not a red. The error scan can pass
  vacuously; Step 4's deliberate-red test exists to catch exactly that.
- **`--print-logs` may still also write the rolling file** — fine; we scan
  the stream regardless.
- **Log format remains an unstable API.** Keep the count-guard as the
  cheap tripwire for the *next* format change, and keep all three checks'
  intent documented inline so a future reader knows the trap.
- **Don't touch tiers 1–2.** They're format-independent and trustworthy.
- **One commit per step** per `~/.config/opencode/rules/workflow.md` when
  implementation begins (separate, explicit step — not now).
