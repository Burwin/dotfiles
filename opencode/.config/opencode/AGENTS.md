# Personal Global Rules

These are mbh's personal rules for OpenCode. They apply to every session,
regardless of repo. Project-level `AGENTS.md` files compose on top of these
and take precedence on project-specific concerns.

## How rules are loaded

- **Always loaded** (via `opencode.json` `instructions`):
  - `rules/safety.md` — non-negotiable guardrails
  - `rules/communication.md` — response style and task management
- **Loaded on demand** (lazy `@references` below):
  - `@rules/code-style.md` — formatting, naming, language conventions
  - `@rules/workflow.md` — commits, branches, PRs, testing
  - `@rules/tools.md` — preferred CLI tools and package managers
  - `@rules/project-structure.md` — file layout defaults
  - `@rules/documentation.md` — two-layer (human + LLM) doc convention

## External File Loading

CRITICAL: When a rule below references a file (e.g., `@rules/workflow.md`), use
your Read tool to load it on a need-to-know basis, when its subject matter is
relevant to the current task.

Instructions:

- Do NOT preemptively load all references — use lazy loading based on actual
  need for the task at hand.
- When loaded, treat the file's content as mandatory instructions that override
  generic defaults.
- Follow references recursively when needed.

## Category index

- **Code style and language conventions:** `@rules/code-style.md`
- **Git workflow, commits, branches, PRs:** `@rules/workflow.md`
- **Tooling and CLI preferences:** `@rules/tools.md`
- **Sending / reading email (Gmail):** `gmail-send` / `gmail-*` CLI — details in `@rules/tools.md`
- **Project structure and file layout:** `@rules/project-structure.md`
- **Documentation style (two-layer convention):** `@rules/documentation.md`

## Precedence

When in doubt: project `AGENTS.md` > these global rules > generic defaults.
If a project rule contradicts a global rule, follow the project rule and
optionally note the divergence in your response.

## Email (`gmail-*` CLI)

Send and read email with the `gmail-*` CLI in `~/.local/bin/` (`gmail-send`,
`gmail-list`, `gmail-get`, `gmail-needs-reply`, …). There is **no**
`sendmail`/`msmtp`/`mutt`/`gam` — don't probe for them. Quick send:

    gmail-send --to <addr> --subject <s> --body-file <path>   # + --cc/--bcc/--attach/--draft

`--draft` stages the message in Gmail for human review (preferred for
customer-facing mail); auth via `gmail-auth status|login` (a `gmail-*`
command that prints nothing and exits 3 = re-login). Full flags and the
read/triage subcommands live in `@rules/tools.md`.

## Asana MCP

The official Asana MCP server is configured at the OpenCode level (always-on,
all sessions). Tools are namespaced `asana_*` (~21 tools across tasks,
projects, portfolios, goals, teams, users, status updates). The OAuth token
is workspace-scoped to Bamboo.

When the user asks about Asana work, prefer:

- `asana_get_my_tasks` for "what's on my plate" / "what's due" queries.
- `asana_search_objects` to resolve names to GIDs before calling
  object-specific reads (`asana_get_task`, `asana_get_project`, etc.).
- `asana_get_status_overview` for project/portfolio status — it searches
  internally, so don't chain other search tools first.
- `asana_create_tasks` / `asana_update_tasks` for batch ops (up to 50
  per call).

### Resolving task references ("SH-264", "ENG-123", etc.)

`SH-NNN` / `ENG-NNN` style IDs are Asana's per-project task numbering
(custom field, not the task name or GID). They are NOT indexed by
`asana_search_objects`. Resolution order:

1. **Check the working directory name first.** Worktrees in
   `~/src/bamboo/<customer>/<repo>/<TASK-ID>` are named after the
   Asana card we're working on. If the cwd ends in `SH-264`, that's
   the task — no search needed beyond confirming the GID.
2. Use `asana_search_tasks` (not `asana_search_objects`) with the ID
   as the `text` param. It searches name, description, AND the
   project task-number field, so it will hit even when the task name
   doesn't contain the ID.
3. If still no match, `asana_search_tasks` with the ID as `text` and
   `projects_any` filtered to the relevant project usually narrows it.

The task name will look unrelated to the ID (e.g. SH-264 →
"Change 'Approve' to 'Complete'"). Confirm via `permalink_url` or
project membership, not by name matching.

### Moving a task between sections (Kanban move)

Single-step workflow, ~3 tool calls:

1. Resolve the task GID (see above) and request
   `memberships.project.gid,memberships.section.name` so you know
   which project it's in.
2. `asana_get_project` with `include_sections: true` to get the
   target section GID. Section names in the Schneller project are
   `TODO`, `IN PROGRESS`, `REVIEW`, `DONE`, `BACKLOG`, `CANCELLED`
   (project GID `1209584841590195`).
3. `asana_update_tasks` with
   `add_projects: [{project_id, section_id: <target>}]`. Adding a
   task to a project it's already in moves it to the specified
   section; no need to remove + re-add.

For repeat moves in the Schneller project, the section GIDs are:

- TODO `1209584841590196`
- IN PROGRESS `1209948358802846`
- REVIEW `1210439053497618`
- DONE `1209948358802847`
- BACKLOG `1210512963483553`
- CANCELLED `1210618154771014`

Gotchas:

- MCP tokens cannot be used against Asana's REST API. If we ever build a
  local `src/asana/` package in `~/src/bamboo/tools`, it needs a separate
  API app + PAT.
- Schema bloat: ~5–10K input tokens per turn always-on. Revisit per-agent
  gating if context costs become annoying.
- Workspace-scoped: only Bamboo. Switching workspaces requires
  `opencode mcp logout asana && opencode mcp auth asana`.
- `asana_search_tasks` is Premium-tier-and-up only; we have it on Advanced.
- `asana_delete_task` is permanent.
- Time tracking, goal mutation, tag CRUD, custom-field-definition CRUD,
  sections-as-standalone, and webhooks are NOT exposed via MCP — they
  require the REST API.
- **Use plain text for comments.** When using `asana_add_comment`, prefer
  the `text` field over `html_text` to avoid rendering issues. Asana has
  limited HTML support — avoid `<p>`, `<div>`, block-level tags. Stick to
  `<strong>`, `<br/>`, and `<a data-asana-gid="...">` if using html_text.

OAuth callback URL (in case re-registration is needed):
`http://127.0.0.1:19876/mcp/oauth/callback`

## GitHub Copilot review re-trigger

Re-requesting a Copilot review on a PR after the bot has already
submitted a review is non-obvious. The standard REST endpoint
(`POST /repos/{owner}/{repo}/pulls/{n}/requested_reviewers` with
body `{"reviewers": ["Copilot"]}`) returns HTTP 201 but silently
fails to fire a `review_requested` timeline event, and Copilot
never re-reviews. Two workarounds, in escalation order:

1. **First re-request: `gh pr edit <PR> --add-reviewer "@copilot"`.**
   The `@copilot` syntax (note the `@` prefix and lowercase) was
   added to the `gh` CLI in ~April 2026 and works against the
   bot's app login. Simplest path; usually works once.

2. **Subsequent re-requests: GraphQL `requestReviews` + `botIds`.**
   If `gh pr edit` stops firing the timeline event after the first
   re-request (observed during SH-274 — possibly rate-limit or
   bot-state-machine quirk), fall back to:

   ```bash
   # Get the PR node ID
   gh api graphql -f query='
   query {
     repository(owner: "ORG", name: "REPO") {
       pullRequest(number: 51) { id }
     }
   }'

   # Trigger the re-review
   gh api graphql -f query='
   mutation {
     requestReviews(input: {
       pullRequestId: "PR_NODE_ID",
       botIds: ["BOT_kgDOCnlnWA"],
       union: true
     }) {
       pullRequest {
         reviewRequests(first: 5) {
           nodes { requestedReviewer { ... on Bot { login } } }
         }
       }
     }
   }'
   ```

   The `botIds` field is GraphQL-only — REST and `gh pr edit`
   don't surface it. `union: true` adds to the existing reviewer
   set rather than replacing it. Copilot's bot node ID is
   `BOT_kgDOCnlnWA`; discover others via `... on Bot { id }` on a
   PR where the bot has reviewed.

Validation gotchas:

- **REST is authoritative**: `gh api repos/.../pulls/{n}/requested_reviewers`
  shows Copilot in the `users` array if the re-request took.
- **`gh pr view --json reviewRequests` lies**: the CLI wrapper
  silently filters out bots. It returns `[]` even when REST and
  GraphQL both confirm Copilot is queued. Don't trust it for
  Copilot validation.
- **Timeline lag**: `review_requested` events sometimes don't
  appear immediately. Wait ~5s before checking.
- **Review wait**: Copilot takes ~3 min from `copilot_work_started`
  to submitted review. Poll `gh pr view <PR> --json reviews` for
  a new entry with `author.login = "copilot-pull-request-reviewer"`.

Loop exit signal: Copilot's review body reads "Copilot reviewed
N out of N changed files in this pull request and generated no
new comments." That's the clean state; merge can proceed.

Reply-then-re-request etiquette: reply to each inline comment via
`POST /repos/.../pulls/{n}/comments/{comment_id}/replies` with a
brief "Fixed in <sha>" note before re-requesting. Future human
reviewers see the resolution trail without having to diff commits.

## Plans

Active implementation plans live in `docs/plans/`. When asked to work on a
plan:

1. Read the plan file to understand the current status and next step
2. Check the Progress block and implementation order for what's pending
3. Follow the phase order — each phase is independently shippable

The cost-tracker plan was archived 2026-06-10 to
`docs/archive/opencode/PLAN-cost-tracker.md`; its per-task successor
shipped and was archived alongside it as
`docs/archive/opencode/PLAN-cost-pertask-tmux-status.md`.

### Archiving plans

When a plan ships, is superseded, or otherwise becomes reference material,
move it under `docs/archive/<category>/` (existing categories include
`opencode/` and `toggl/`; pick the closest match or ask before adding a
new one):

- **Filename**: `PLAN-<topic>.md`. Strip the leading `<category>-` prefix
  from the source directory name. Example:
  `docs/plans/opencode-cost-breakdown/PLAN.md` →
  `docs/archive/opencode/PLAN-cost-breakdown.md`.
- **Use `git mv`** so history follows the file.
- **Prepend a blockquote header** at the top of the moved file with the
  archive date, what (if anything) supersedes it, and a "decision history
  below preserved as-is" note. Existing files under
  `docs/archive/opencode/` are the reference template.
- **Remove the now-empty source directory** under `docs/plans/`.
- **Cross-references inside other already-archived files are
  intentionally left to rot** — see `docs/archive/README.md`. Update only
  references in *active* plans/docs that materially mislead a reader
  about the current state.
