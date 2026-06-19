# Convert common prompts into opencode slash commands (MASTER-1804)

Status: shipping — steps 1–23 complete, Step 24 (deploy via PR → `m`) in progress.

Asana: MASTER-1804 — "Convert common prompts into slash commands"
(https://app.asana.com/1/1203819684139908/project/1204506183888935/task/1215832930545833)

## Goal

Turn the prompts I paste most often into first-class opencode slash
commands so they're one keystroke away in the TUI, version-controlled,
and consistent. First pass ships four commands behind a new `bam-`
namespace, plus a small validator that enforces the convention so future
commands can't silently break.

## Scope (first pass)

Four commands, all prefixed `bam-`:

| Command            | Agent | What it does                                                                 |
|--------------------|-------|------------------------------------------------------------------------------|
| `/bam-review-task` | plan  | Review a task; flag clarifications/unblockers; check if it's stale.          |
| `/bam-tdd-plan`    | plan  | Draft a test-by-test red-green plan with trigger sentences + model tags.     |
| `/bam-deploy-dev`  | build | Commit, push, open PR, run Copilot loop until clean, ensure CI green, merge. |
| `/bam-copilot-loop`| build | Re-trigger Copilot review and iterate until "no new comments".               |

Out of scope (candidates for a later pass): `/bam-move-task`,
`/bam-pr-comments`, `/bam-draft-reply`.

## Decisions (locked, from kickoff conversation)

- **Repo: public dotfiles**, not the private `bamboo/tools` repo. Slash
  commands are the same class of artifact as `rules/`, `skills/`, and
  `AGENTS.md` — all of which already live here. No client/project-sensitive
  data is embedded (the bar that pushed the Toggl tooling private); these
  commands only encode generic engineering workflow already documented in
  the public `AGENTS.md`.
- **`bam-` prefix convention** for all custom commands. Namespaces them
  away from opencode built-ins (`/init`, `/undo`, `/redo`, `/share`,
  `/help`) and makes them self-identifying in the TUI.
- **Work happens in the `MASTER-1804` dotfiles worktree** off branch `m`;
  PR targets `m` (the repo default — NOT `main`/`master`).
- **opencode location**: global markdown commands at
  `~/.config/opencode/commands/` (plural, per
  https://opencode.ai/docs/commands). Filename (sans `.md`) = command name.
- **Validator is the TDD target.** Markdown command files aren't otherwise
  "testable"; a small dependency-free Bun validator over `commands/*.md`
  gives us a meaningful red-green-refactor cycle AND a durable convention
  guard for every future `bam-` command.
- **Models**: mechanical TS/test/wiring steps → **Grok Build 0.1**;
  judgment-heavy command authoring + the deploy/Copilot loop →
  **Opus (opencode/claude-opus-4-8)**. (Task default set: Opus, Grok Build 0.1.)

## Where files live

```
opencode/.config/opencode/
├── commands/                       # NEW — whole-dir linked by install.sh
│   ├── bam-review-task.md          #   (the four converted prompts)
│   ├── bam-tdd-plan.md
│   ├── bam-deploy-dev.md
│   └── bam-copilot-loop.md
└── commands-validate/              # NEW — dev/CI only, NOT linked
    ├── validate.ts                 #   pure validator (no deps; bun:test)
    ├── validate.test.ts            #   the validator's own TDD suite
    ├── commands.test.ts            #   content tests for the real commands
    └── fixtures/                   #   good/bad command files for tests
        ├── bam-good-example.md
        ├── bad-name.md
        ├── bad-no-description.md
        └── bad-empty-body.md
```

- `commands/` is added to the `FILES` array in `opencode/install.sh` as a
  **whole-dir link**, mirroring how `skills/` is handled — so new `bam-`
  commands need no installer edit, just a restart.
- `commands-validate/` is deliberately **not** in `FILES`: it's a repo-side
  quality gate, not runtime config. Keeping it out of `commands/` keeps the
  deployed directory pure `.md` (the command loader only reads `*.md`, but
  we still don't want test files symlinked into the live config dir).

## Validator design

`validate.ts` — zero runtime deps (Bun + Node `fs` only; frontmatter is
simple `key: value` lines, parsed by a tiny hand-rolled reader — no YAML
dependency).

```ts
export interface CommandIssue { file: string; problem: string }

// Pure: validate a single file's name + raw content.
export function validateCommand(fileName: string, content: string): CommandIssue[]

// Scan a directory, run validateCommand on each *.md, aggregate.
export function validateAll(dir: string): CommandIssue[]
```

Rules enforced (each is its own test in the plan below):

1. **Filename**: matches `^bam-[a-z0-9]+(-[a-z0-9]+)*\.md$` (bam- prefix,
   kebab-case, `.md`).
2. **Frontmatter**: file starts with a `---` … `---` block that parses.
3. **`description`**: present and non-empty (opencode shows it in the TUI;
   commands without one are poorly surfaced).
4. **Body**: non-empty prompt/template after the frontmatter.
5. **`model`** (if present): `provider/model-id` shape (contains `/`).
6. **`agent`** (if present): one of the known agents
   `{build, plan, general, explore}`.

Run via `bun test ./opencode/.config/opencode/commands-validate/`.

## TDD implementation order

Conventions for this section:

- **Each step is a single test OR a single implementation move** — never
  both. RED = write a failing test. GREEN = make it pass. REFACTOR =
  restructure with the suite green.
- **Trigger sentence**: when a step completes, post the **next** step's
  trigger verbatim so the following step (and its model) is unambiguous.
  Format:

  > ▶️ Step `N` of 24 — `<title>` — model: `<model>` — plan:
  > `docs/plans/opencode-slash-commands/PLAN.md`

- Model per step is in the **Model** column. Cheap/mechanical → Grok Build
  0.1; judgment → Opus (opencode/claude-opus-4-8).

### Phase A — Validator (red-green-refactor)

| # | Kind  | Step | Model |
|---|-------|------|-------|
| 1 | setup | Scaffold `commands/` + `commands-validate/` (with `fixtures/`); add a `validate.ts` stub exporting no-op `validateCommand`/`validateAll`; add empty `validate.test.ts` that imports them; confirm `bun test …/commands-validate/` runs (0 tests). | Grok Build 0.1 |
| 2 | RED   | Test: `validateCommand` flags a file whose name violates `bam-…kebab….md` (fixture `bad-name.md`). Fails (no check yet). | Grok Build 0.1 |
| 3 | GREEN | Implement the filename rule. Test 2 passes. | Grok Build 0.1 |
| 4 | RED   | Test: flags missing/unparseable frontmatter AND missing/empty `description` (fixture `bad-no-description.md`). | Grok Build 0.1 |
| 5 | GREEN | Implement frontmatter parse + `description` rule. Test 4 passes. | Grok Build 0.1 |
| 6 | RED   | Test: flags an empty body (frontmatter only, no template text). | Grok Build 0.1 |
| 7 | GREEN | Implement the body-non-empty rule. Test 6 passes. | Grok Build 0.1 |
| 8 | RED   | Test: flags a bad `model` (no `/`) and an unknown `agent`, but allows their absence. | Grok Build 0.1 |
| 9 | GREEN | Implement optional `model`/`agent` rules. Test 8 passes. | Grok Build 0.1 |
| 10| REFACTOR | Collapse the checks into a rule table iterated by `validateCommand`; add a happy-path test (`bam-good-example.md` → zero issues) and keep the whole suite green. | Grok Build 0.1 |
| 11| RED   | Test: `validateAll(fixtures)` returns issues for the bad fixtures and none for the good one. | Grok Build 0.1 |
| 12| GREEN | Implement `validateAll` (dir scan of `*.md`). Test 11 passes. | Grok Build 0.1 |

### Phase B — Author the four commands (each authored to pass a content test)

| # | Kind  | Step | Model |
|---|-------|------|-------|
| 13| RED   | Test: `commands/bam-review-task.md` exists, passes `validateCommand`, and its body references task resolution + "clarif…" + "stale/refresh". | Opus (claude-opus-4-8) |
| 14| GREEN | Author `bam-review-task.md` (see "Command content" below). Test 13 passes. | Opus (claude-opus-4-8) |
| 15| RED   | Test: `bam-tdd-plan.md` passes validator; body references "separate test", "trigger", "Step N of M", "model". | Opus (claude-opus-4-8) |
| 16| GREEN | Author `bam-tdd-plan.md`. Test 15 passes. | Opus (claude-opus-4-8) |
| 17| RED   | Test: `bam-deploy-dev.md` passes validator; body references commit, push, PR, base branch, Copilot, merge. | Opus (claude-opus-4-8) |
| 18| GREEN | Author `bam-deploy-dev.md`. Test 17 passes. | Opus (claude-opus-4-8) |
| 19| RED   | Test: `bam-copilot-loop.md` passes validator; body references `@copilot`, GraphQL/`botIds`, "no new comments". | Opus (claude-opus-4-8) |
| 20| GREEN | Author `bam-copilot-loop.md`. Test 19 passes. | Opus (claude-opus-4-8) |

### Phase C — Install wiring

| # | Kind  | Step | Model |
|---|-------|------|-------|
| 21| RED   | Test: read `opencode/install.sh`; assert its `FILES` array contains `commands`. Fails. | Grok Build 0.1 |
| 22| GREEN | Add `commands` to `FILES`; run `./opencode/install.sh`; verify `~/.config/opencode/commands` symlinks into this repo. Test 21 passes. | Grok Build 0.1 |

### Phase D — Integration & deploy

| # | Kind  | Step | Model |
|---|-------|------|-------|
| 23| VERIFY | Full `bun test …/commands-validate/` green; run installer; restart opencode; manually smoke each `/bam-*` command surfaces in the TUI with its description. | Opus (claude-opus-4-8) |
| 24| DEPLOY | Per `@rules/workflow.md` + `@rules/safety.md`: commit (Conventional Commits), push, open PR → `m`, run the Copilot loop until clean, confirm CI green + Copilot clean, then merge. | Opus (claude-opus-4-8) |

M = 24. Adjacent trivial GREEN steps may be executed back-to-back, but each
keeps its own commit so the red→green history is legible.

### Kickoff trigger

> ▶️ Step 1 of 24 — Scaffold `commands/` + `commands-validate/` + test
> harness — model: Grok Build 0.1 — plan:
> `docs/plans/opencode-slash-commands/PLAN.md`

## Command content (authoring spec for Phase B)

All bodies encode workflow already public in `AGENTS.md`/`rules/` — no new
sensitivity. Each uses `$ARGUMENTS` where a target is passed.

- **bam-review-task** (`agent: plan`): Resolve the task — `$ARGUMENTS` as a
  task id/URL, else infer from the cwd worktree name (per `AGENTS.md`
  "Resolving task references"). Summarize the ask. Then answer: anything to
  clarify or unblock before starting? Has it gone stale since last touched?
  List open questions with recommended defaults. Do **not** start
  implementing.
- **bam-tdd-plan** (`agent: plan`): Produce a plan at
  `docs/plans/<topic>/PLAN.md` where each step is a separate test, test
  steps are separate from implementation steps, every step has an explicit
  trigger sentence (Step N of M, plan path, title, model), and every step
  names an LLM model capable of it with confidence. Output the plan; don't
  implement. `$ARGUMENTS` = feature/task.
- **bam-deploy-dev** (`agent: build`): Follow `@rules/workflow.md` +
  `@rules/safety.md`. Commit + push the current branch; open a PR (verify
  base branch — bamboo repos may use `m`); run `/bam-copilot-loop`; ensure
  CI green AND Copilot clean; then merge. Confirm before any merge/force per
  safety rules.
- **bam-copilot-loop** (`agent: build`): `$ARGUMENTS` = PR number. Reply
  "Fixed in `<sha>`" to each inline comment, then re-request review
  (`gh pr edit <PR> --add-reviewer "@copilot"`; fallback GraphQL
  `requestReviews` + `botIds: ["BOT_kgDOCnlnWA"]`, `union: true`). Validate
  via REST (`gh api …/requested_reviewers`) — `gh pr view --json
  reviewRequests` hides bots. Poll `gh pr view <PR> --json reviews` for
  `copilot-pull-request-reviewer`; exit when the review body reads
  "generated no new comments".

## Testing strategy

- **Unit/integration**: `bun test ./opencode/.config/opencode/commands-validate/`
  — the validator suite (Phases A–C). Hermetic; uses in-repo fixtures.
- **Install wiring**: a unit assertion that `FILES` contains `commands`
  (Step 21). A full sandboxed `install.sh` run is intentionally **not**
  automated — the script's systemd block (`systemctl --user …`) makes it
  fragile under CI/temp HOME. We guard the array statically and verify the
  symlink manually after running the installer (Step 22).
- **Manual smoke** (Step 23): restart opencode; type `/bam-` and confirm all
  four commands appear with descriptions; dry-run `/bam-review-task` against
  a known task.

## Risks & gotchas

1. **Command dir name is `commands/` (plural).** The opencode.json *key* is
   `command` (singular); the on-disk dir is `commands/`. Don't mix them.
2. **Whole-dir link deploys everything in `commands/`.** Keep it `.md`-only;
   the validator lives in a sibling dir, not inside `commands/`.
3. **Restart required.** opencode loads commands at startup; new/edited
   commands won't appear until opencode is restarted.
4. **Base branch is `m`.** The PR (Step 24) must target `m`, not main/master.
5. **No new YAML dep.** Frontmatter parsing stays hand-rolled to keep the
   validator dependency-free and fast under `bun test`.
6. **Built-in name collisions.** `bam-` prefix avoids clobbering built-ins;
   the filename rule encodes the prefix so the validator catches a stray
   un-prefixed command.

## Progress

- [x] Phase A — validator red-green-refactor (steps 1–12)
- [x] Phase B — author four `bam-` commands (steps 13–20)
- [x] Phase C — install.sh wiring (steps 21–22)
- [ ] Phase D — integration smoke ✓ (step 23); deploy/PR/Copilot/merge in progress (step 24)

## References

- Task: Asana MASTER-1804 (description = canonical example of a "common prompt").
- opencode commands: https://opencode.ai/docs/commands
- `opencode/install.sh` — `FILES` array + whole-dir link pattern (skills/).
- `opencode/.config/opencode/AGENTS.md` — Copilot re-trigger loop, Asana
  task resolution, move-task workflow (source material for command bodies).
- `opencode/.config/opencode/rules/workflow.md` — commits/branches/PR/testing.
- House plan style: `docs/plans/tmux-opencode-pause-indicator/PLAN.md`.
