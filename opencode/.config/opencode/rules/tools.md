# Tooling Preferences

Defaults when the project doesn't dictate otherwise. Per-repo `AGENTS.md`
overrides these.

## Search and file navigation

- `rg` (ripgrep) instead of `grep`.
- `fd` instead of `find`.
- `jq` for JSON; `yq` for YAML.

## JavaScript / TypeScript

- **Use the lockfile present** to pick the package manager:
  - `bun.lock` / `bun.lockb` → `bun`
  - `pnpm-lock.yaml` → `pnpm`
  - `yarn.lock` → `yarn`
  - `package-lock.json` → `npm`
- **New repo with no lockfile → `npm`.**
- Don't switch a repo's package manager without asking.
- Run scripts via the matching runner (`bun run`, `pnpm run`, etc.) rather than
  invoking node directly, so workspace resolution works.

## Python

<!-- TODO: settle on uv vs. poetry vs. pip+venv. -->

For now: defer to whatever the repo uses (`pyproject.toml` + `uv.lock`,
`poetry.lock`, `requirements.txt`, etc.). Don't introduce a new tool.

## .NET

- Run `dotnet tool restore` before `dotnet ef …` if `dotnet-tools.json` is
  present.
- Prefer `dotnet test --filter "FullyQualifiedName~..."` over editing csproj /
  test config to narrow runs.

## General

- Prefer the project's existing test runner, linter, and formatter. Don't
  introduce a new one without asking.
- When running a build/test/lint command for the first time in a session,
  prefer the canonical entry point (`./start-web.sh`, `npm test`, the documented
  task) over reconstructing the command from raw tool invocations.
