# `/bam-specs-amend` table guardrails (MASTER-2048)

> **Status:** shipped; archived 2026-09-16. Nothing supersedes it.
> Merged to `m` via PR #30 (squash `ab16d05`). Asana MASTER-2048 → DONE.
> Shipped artifact: `opencode/.config/opencode/commands/bam-specs-amend.md` §4/§5
> (table as regular TUI output, no format-hop, explicit accept) plus the
> `communication.md` GFM-table hatch and three commands.test.ts pins.
> Decision history below preserved as-is.

**Asana:** MASTER-2048 (GID `1218542806195503`) — MASTER / IN PROGRESS
**Permalink:** https://app.asana.com/1/1203819684139908/project/1204506183888935/task/1218542806195503
**Worktree:** `~/src/dotfiles/MASTER-2048`
**Incident session:** `ses_f5573d50effe04gwpY7w6Bkarz` (H-194 `/bam-specs-amend`, grok-build-0.1)

## TL;DR

H-194 `/bam-specs-amend` did the right Q&A and the right constitution
change, then failed to show a usable amendment table, format-hopped, and
committed without an explicit accept. Keep the 3-col GFM table
(MASTER-2039). Teach the command a worked example as **regular TUI
output** (not the question UI), ban format-hop, and refuse to commit
until explicit accept. Widen `communication.md`'s existing "too long"
hatch to GFM tables.

**Done** = `bam-specs-amend.md` §4/§5 + three new token pins in
`commands.test.ts` + the `communication.md` hatch. Deploy via the
existing `commands/` symlink.

## Goal & scope

### In

- `opencode/.config/opencode/commands/bam-specs-amend.md` §4 and §5
- `opencode/.config/opencode/commands-validate/commands.test.ts`
  (`describe("bam-specs-amend command")` only)
- `opencode/.config/opencode/rules/communication.md` "Drafts and the
  question tool" (prose only; no new rules-validate test)

### Out

- Model pin on `bam-specs-amend.md` (frontmatter stays `agent: build`,
  no `model:`)
- Changing the 3-col GFM layout, stacked blocks, files-on-disk, or the
  TUI renderer
- `/bam-specs-init`, `/bam-specs-gaps`
- The shipped MASTER-2002 / MASTER-2039 plan files
- `validate.ts`, `install.sh`
- Editing any `constitution.md`
- A rules-validate pin for `communication.md` (review Q4)

## Decisions (locked)

From the MASTER-2048 pre-implementation review (comment 2026-09-16):

| # | Topic | Lock |
| --- | --- | --- |
| 1 | Medium | Keep GFM `ID \| description \| action`. H-194 was Grok Build 0.1 forming tables badly, not a TUI limit. Grok 4.6 and Muse Spark 1.3 Contributor already render tables (one bad first table, then one fix, is normal). |
| 2 | Guardrails | (a) Worked example as regular output, not in the question module. (b) Never format-hop. (c) Never treat anything but explicit accept as accept. |
| 3 | Where | Reconcile: widen `communication.md`'s "too long → message body" hatch to GFM tables. `bam-specs-amend.md` §4/§5 gets the example + no format-hop + explicit accept. |
| 4 | Tests | Pin amend-command tokens in `commands.test.ts`. `communication.md` prose-only. |

MASTER-2039 Decision 3 (3-col table, `\|` escape, no alternate
layout) still holds. This card adds *where and how* to show that table,
not a new layout.

## Design

```
opencode/.config/opencode/
├── commands/bam-specs-amend.md          # §4 + §5
├── commands-validate/commands.test.ts   # three new tests in existing describe
└── rules/communication.md               # Drafts and the question tool
```

Run: `bun test ./opencode/.config/opencode/commands-validate/`

Existing tests stay green: `| id | description | action |`,
`replace with` / `replaces`, `keep / modify / drop`, `git add` /
`commit`. Body is lowercased in `readBamSpecsAmend()`.

### §4 after the change (authoring spec)

Keep current bullets (columns, related pairs adjacent, chronological
else, on-disk tags, full on-disk line, `\|` escape). Add:

- Show the GFM table in the **message body as regular output**. Do not
  put the table in the question tool.
- Include a **worked example** (copy-pasteable GFM, two-row replace
  pair). Action on the old row is `replace with <new id>`, not
  `replace with <old id>` (H-194 wrote the self-id).
- **Never format-hop.** If the first table is badly formed, fix that
  GFM table. Do not switch to bullets, ASCII, fenced-as-escape, or
  paraphrases.

Worked example to embed in §4:

```
| ID | description | action |
| --- | --- | --- |
| XX-1 | Old rule text. [REPLACED_BY: XX-2] | replace with XX-2 |
| XX-2 | New rule text. [REPLACES: XX-1] | replaces XX-1 |
```

### §5 after the change (authoring spec)

Keep keep / modify / drop and the iterate loop. Add:

- Rendering complaints, "try again", and format complaints are not
  accept.
- Do not commit until the human **explicitly accepts**.

After the table is in the message body, ask accept / modify / drop as a
plain-text question in that **same message**. Do not call the question
tool on that turn (otherwise the question UI hides the table). This
matches the `communication.md` hatch below.

### `communication.md` hatch (authoring spec)

Keep the embed-in-question-tool default for short non-table drafts.
Widen the existing escape hatch:

Current: too long to embed → plain-text question in the message body.

New: too long to embed, **or a GFM table**, → put it in the message
body as regular output and ask a plain-text (non-tool) question in that
same message. Do not call the question tool on that turn. Wait for the
reply.

Do not add a rules-validate test.

## TDD implementation order

Each step is a single test **or** a single move, never both. **M = 9.**

Token discipline: each GREEN must not introduce a *later* test's
tokens, or the next RED will not fail. Tokens below are matched against
the lowercased body.

### Phase A — amend command + tests

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 1 | RED | New test `body shows the amendment table as regular output (§4)`: `/regular output/`, `/message body/`, `/worked example/`. Fails (tokens absent). Do not add `format-hop` or `explicit accept` assertions yet. | cheap |
| 2 | GREEN | Edit `bam-specs-amend.md` §4: table goes in the message body as regular output; not in the question tool; embed the XX-1/XX-2 worked example. Do **not** add `format-hop` or `explicit accept`. Existing §4 test stays green. | premium |
| 3 | RED | New test `body forbids format-hop (§4)`: `/format-hop/`. Fails. Do not add `explicit accept` yet. | cheap |
| 4 | GREEN | Add to §4: never format-hop; if the first table is badly formed, fix that GFM table; do not switch to bullets, ASCII, or paraphrase. Do **not** add `explicit accept`. | premium |
| 5 | RED | New test `body requires explicit accept before commit (§5)`: `/explicit accept/`. Fails. | cheap |
| 6 | GREEN | Edit §5: rendering complaints are not accept; do not commit until the operator explicitly accepts; ask accept/modify/drop as a plain-text question in the same message as the table; do not call the question tool on that turn. | premium |

### Phase B — communication.md (prose only)

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 7 | GREEN | Edit `communication.md` "Drafts and the question tool" to the hatch in Design. No new test (review Q4). `commands-validate` and `rules-validate` stay green. | premium |

### Phase C — verify + deploy

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 8 | VERIFY | `bun test ./opencode/.config/opencode/commands-validate/` green. Existing amend tests still pass. | cheap |
| 9 | DEPLOY | Per `@rules/workflow.md`: Conventional-Commits commit, push, PR → base `m`, `/bam-copilot-loop` until "no new comments". Merge on explicit confirm. Fast-forward main checkout, restart opencode. | premium |

## Testing strategy

- Content suite is the TDD seam. One focused test per new behavior.
  Each RED hinges on tokens **absent** from `bam-specs-amend.md` at
  that point.
- `communication.md` is smoke-only (no new rules test).
- Interactive table rendering is the next live `/bam-specs-amend`. Do
  not amend a live constitution as part of this card.

## Risks & gotchas

| Risk | Mitigation |
| --- | --- |
| Token leak makes a later RED pass | Each GREEN lists forbidden tokens. Do not draft ahead. |
| Existing §4/§5 tests go red | Keep the header row, `replace with` / `replaces`, and `keep / modify / drop`. |
| GREEN 2 example uses `replace with XX-1` (H-194 self-id bug) | Example action on the old row is `replace with XX-2`. |
| Question tool on the same turn hides the table | §5 + `communication.md`: no question tool on the table turn. |
| Format-hop under user yelling | Ban is unconditional. One GFM fix, not a new medium. |
| Agent still commits on "try again" | `/explicit accept/` pin + §5 "rendering complaints are not accept". |
| `communication.md` still says embed drafts in the question tool | Step 7 widens the hatch; do not delete the short-draft default. |
| Restart required | opencode loads commands at startup (step 9). |

## Progress

- [x] Step 1 — RED: table as regular output tokens
- [x] Step 2 — GREEN: §4 message body + worked example
- [x] Step 3 — RED: format-hop token
- [x] Step 4 — GREEN: never format-hop
- [x] Step 5 — RED: explicit accept token
- [x] Step 6 — GREEN: §5 explicit accept
- [x] Step 7 — GREEN: communication.md hatch
- [x] Step 8 — VERIFY: commands-validate suite
- [x] Step 9 — DEPLOY: squash, PR → m, copilot-loop (merge/ff/restart gated)

## Session exit (MANDATORY)

A step is not done until that step's `## Progress` line is `- [x]`
**on disk**. `bamboo plans run` re-reads PLAN.md after exit 0; a
remaining `- [ ]` prints `unchecked` and does not advance.

Exact order (no shortcuts):

1. Finish the step's work (the test or move the step names; run the
   listed verification).
2. Edit this PLAN.md: change that step's `- [ ]` to `- [x]`.
3. **Check the progress (do not skip):** before you output *anything*
   that looks like a trigger, **use the Read tool** on this PLAN.md.
   Read `## Progress`. Explicitly confirm in your reasoning that the
   line for the step you just finished now contains `[x]`. If it does
   not, go back to step 2.
4. Only after that Read shows the tick: commit (work + this plan file)
   on the plan's cadence, then print the **next** step's trigger
   sentence **verbatim** as the very last output. Nothing after the
   trigger.

Hard rule: do not print a `▶️ Step ...` trigger while this step's
Progress line is still `[ ]` on disk.

## References

- Card: MASTER-2048 (review comment 2026-09-16)
- Incident: H-194 amend, session `ses_f5573d50effe04gwpY7w6Bkarz`,
  commit `110b1e2` in `~/src/hh/H-194`
- Predecessor: MASTER-2039 (`docs/archive/opencode/PLAN-bam-specs-amend-full-text.md`)
- Command: `opencode/.config/opencode/commands/bam-specs-amend.md`
- Tests: `opencode/.config/opencode/commands-validate/commands.test.ts`
- Tiers: `@rules/plans.md`

---

After each step completes, post the next trigger verbatim.

- After 1 → ▶️ Step 2 of 9 — GREEN: §4 message body + worked example — model: premium — plan: `docs/plans/bam-specs-amend-table-guardrails/PLAN.md`
- After 2 → ▶️ Step 3 of 9 — RED: format-hop token — model: cheap — plan: `docs/plans/bam-specs-amend-table-guardrails/PLAN.md`
- After 3 → ▶️ Step 4 of 9 — GREEN: never format-hop — model: premium — plan: `docs/plans/bam-specs-amend-table-guardrails/PLAN.md`
- After 4 → ▶️ Step 5 of 9 — RED: explicit accept token — model: cheap — plan: `docs/plans/bam-specs-amend-table-guardrails/PLAN.md`
- After 5 → ▶️ Step 6 of 9 — GREEN: §5 explicit accept — model: premium — plan: `docs/plans/bam-specs-amend-table-guardrails/PLAN.md`
- After 6 → ▶️ Step 7 of 9 — GREEN: communication.md hatch — model: premium — plan: `docs/plans/bam-specs-amend-table-guardrails/PLAN.md`
- After 7 → ▶️ Step 8 of 9 — VERIFY: commands-validate suite — model: cheap — plan: `docs/plans/bam-specs-amend-table-guardrails/PLAN.md`
- After 8 → ▶️ Step 9 of 9 — DEPLOY: squash, PR → m, copilot-loop, merge on confirm — model: premium — plan: `docs/plans/bam-specs-amend-table-guardrails/PLAN.md`

▶️ Step 1 of 9 — RED: table as regular output tokens — model: cheap — plan: `docs/plans/bam-specs-amend-table-guardrails/PLAN.md`
