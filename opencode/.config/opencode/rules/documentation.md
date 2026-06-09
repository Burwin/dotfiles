# Documentation style

Soft guideline for writing docs in any repo. Loaded on demand when the
task at hand involves writing or substantially editing docs.

## The convention

Every non-trivial doc has **two layers**:

1. **Human layer** — concise, scannable, top of the doc. Optimized for
   a human who needs to do the thing in the next 15 minutes.
2. **LLM layer** — denser, reference-oriented, below the human layer.
   Optimized for an LLM (or a human acting like one) doing deep
   reasoning about the system.

Both layers should be present in the same file. Don't split them into
separate files unless the LLM layer would dwarf the human one by an
order of magnitude.

## Human layer

Heading patterns (use what fits, in roughly this order):

- `## TL;DR` — 3–8 lines. What this is, when to use it, the key
  command or concept. Copy-pasteable code snippets win.
- `## Prerequisites` — bulleted list of things you need before
  starting. Auth, secrets, tools.
- `## Steps` (or `## Quickstart`, `## How to ...`) — numbered list.
  Each step is something a human does. Output of one step feeds the
  next. No background explanation in this section — that goes in the
  LLM layer.

Writing rules for the human layer:

- Short sentences. Active voice.
- Imperative for instructions ("Run `dotnet test`", not "You should
  run `dotnet test`").
- No background, no rationale, no edge cases — those are LLM-layer
  concerns.
- If a step has gotchas, link to the LLM layer ("See
  [Reference / pagination](#pagination) for the multi-page case").
- Code blocks should be runnable as-is. Avoid placeholders unless
  unavoidable; when used, mark them clearly (`<connection-string>`).

## LLM layer

Heading patterns:

- `## Reference` — dense factual content. Schema definitions, field
  meanings, flag tables, exit codes, file paths.
- `## Implementation notes` — how the thing works under the hood.
  Algorithm sketches, why decisions were made, gotchas, edge cases.
  Pointers to source code via `file:line` form.
- `## Decisions log` (for design docs and plans) — running list of
  non-obvious calls + rationale, so the next reader doesn't
  re-litigate them.
- `## Cross-references` — links to related docs, Asana cards, PRs,
  ADRs, glossary entries.

Writing rules for the LLM layer:

- Be exhaustive about facts. Repetition for clarity is fine; an LLM
  reader benefits from the same fact appearing near every place it
  matters.
- Prefer concrete `file:line` references over prose ("see the import
  command" → "see `Commands/ImportSalesforceContacts.cs:42`").
- Spell out implicit invariants. If the staging table is append-only,
  say so explicitly; don't make the reader infer it from absence of
  `UPDATE`.
- Use tables for any decision matrix or option enumeration.
- Glossary terms: bold first occurrence; link to canonical definition
  if it lives in another file.

## When to skip the LLM layer

The convention is for non-trivial docs. Skip the LLM layer when:

- The doc is < 100 lines total and the human layer is self-contained.
- The doc is a one-paragraph note (`CONTRIBUTING.md` addendum,
  changelog entry).
- The doc is a pure index or table of contents pointing to other
  docs.
- The doc is a runbook so prescriptive that "Implementation notes"
  would just repeat the steps.

In those cases the file can be just the human layer. Mention this
choice in a single-line comment at the bottom if it might surprise a
reader.

## Examples

- **Positive (two-layer)**: a long-running multi-phase migration
  `PLAN.md` typically has a TL;DR + phase list (human) and a Reference
  section with glossary, current state, decisions log, and
  cross-references (LLM).
- **Skip-case**: a one-paragraph note added to an existing
  `CONTRIBUTING.md` doesn't need its own LLM layer; the surrounding
  doc provides context.

## Why this convention

Docs serve two different audiences with conflicting needs:

- A human needs to do the task fast. They skim. Anything beyond the
  steps is noise.
- An LLM (or a human deep-debugging) needs background, invariants,
  and pointers. Anything missing is a hallucination risk.

A single doc with both layers serves both audiences from one file,
which means one place to keep current, one place to search, one set
of cross-references. Splitting into separate human and LLM files
doubles maintenance and guarantees drift.
