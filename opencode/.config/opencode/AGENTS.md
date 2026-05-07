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
