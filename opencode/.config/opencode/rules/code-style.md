# Code Style

Universal defaults plus per-language conventions. Per-repo `AGENTS.md` files
override these where they conflict.

## Universal

- **Match the surrounding style** in the file/repo before introducing new
  conventions. If existing code uses tabs, use tabs; if existing tests use
  `should`, use `should`. Don't churn formatting unrelated to your change.
- **Keep changes surgical.** Touch only what the task requires — every changed
  line should trace to the request. Don't refactor or "improve" adjacent code
  that isn't broken.
- **No dead code.** No commented-out blocks "just in case" — git history exists.
  Remove only the imports/variables/functions *your* change orphaned; if you
  spot unrelated pre-existing dead code, mention it rather than delete it unasked.
- **Comments explain *why*, not *what*.** Skip obvious comments. Document
  non-obvious tradeoffs, gotchas, and intent.
- **Composition over inheritance.** Small, well-named functions. Avoid deep
  class hierarchies.
- **Avoid premature abstraction.** Duplicate twice before extracting a shared
  helper. Generic-from-day-one abstractions tend to be wrong.
- **Build only what was asked.** No speculative features, flexibility, or
  configurability nobody requested. If a 200-line solution could be 50, rewrite
  it — ask whether a senior engineer would call it overcomplicated.
- **Errors are not control flow.** Don't `try/except` to drive logic; use it
  only for genuinely exceptional conditions — and skip handling for states that
  can't actually occur.
- **Pure functions where possible.** Push side effects to the edges.

## C# / .NET

- **File-scoped namespaces:** `namespace Foo.Bar;` (not braced).
- **Nullable reference types enabled** (`<Nullable>enable</Nullable>`) globally
  in `Directory.Build.props` or csproj.
- **Records with factory methods** for DTOs:
  ```csharp
  public record DepartmentResponse(string Id, string Name)
  {
      public static DepartmentResponse FromDepartment(Department d) =>
          new(d.Id, d.Name);
  }
  ```
- **Test stack:** xUnit + Shouldly + NSubstitute. Use `result.ShouldBe(expected)`
  rather than `Assert.Equal`.
- **Test layout:** Arrange / Act / Assert, with `#region` blocks if grouping
  helps readability.
- **Naming:** PascalCase for types/methods/properties; `_camelCase` for
  private/internal fields; `s_camelCase` for static fields.
- **Run `dotnet tool restore`** before `dotnet ef …` if `dotnet-tools.json` is
  present.

## TypeScript

<!-- Add as you adopt patterns. -->

## Python

<!-- Add as you adopt patterns. -->

## Bash

<!-- Add as you adopt patterns. -->

## Rust

<!-- Add as you adopt patterns. -->
