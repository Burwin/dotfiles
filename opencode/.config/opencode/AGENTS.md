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
- **Project structure and file layout:** `@rules/project-structure.md`

## Precedence

When in doubt: project `AGENTS.md` > these global rules > generic defaults.
If a project rule contradicts a global rule, follow the project rule and
optionally note the divergence in your response.

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

## Plans

Active implementation plans live in `docs/plans/`. When asked to work on a
plan:

1. Read the plan file to understand the current status and next step
2. Check the Progress block and implementation order for what's pending
3. Follow the phase order — each phase is independently shippable

The cost-tracker plan is at `docs/plans/opencode-cost-tracker/PLAN.md`.
