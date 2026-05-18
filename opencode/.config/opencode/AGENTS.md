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

OAuth callback URL (in case re-registration is needed):
`http://127.0.0.1:19876/mcp/oauth/callback`
