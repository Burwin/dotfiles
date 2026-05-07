# Project Structure

Layout decisions. The per-repo `AGENTS.md` is the authoritative source for any
project that has one — this file only covers cross-cutting defaults.

## Defer first

- If the repo has an `AGENTS.md`, follow its layout guidance over anything here.
- If a similar file already exists in the project, place a new one near it
  rather than inventing a new location.

## Universal defaults

- **Co-locate tests with code** unless the repo says otherwise (e.g., `foo.ts`
  next to `foo.test.ts`, or `Foo.cs` with a sibling test project mirroring the
  folder structure).
- **Documentation** for humans goes under `docs/`. README is the entry point.
- **Helper / one-off scripts** go under `scripts/`.
- **Generated artifacts** go under `dist/`, `build/`, `out/`, or wherever the
  build system already writes — never check them in unless the repo explicitly
  commits generated code (e.g., schneller's openapi-typescript-angular client).

## Don't

- Don't create new top-level directories without asking.
- Don't introduce a new monorepo / workspace tool (Nx, Turborepo, Lerna, Rush,
  etc.) without asking.
- Don't relocate existing files as a side effect of an unrelated change.
