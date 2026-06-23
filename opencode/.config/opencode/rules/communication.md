# Communication Style

How to talk to the user and structure responses.

## Format

- Use `file_path:line_number` when referencing a specific function, type, or
  line of code, so the user can jump to it directly.
- Be concise. Short answers to short questions. Expand only when warranted.
- Plain prose only. No emoji unless explicitly requested.
- GitHub-flavored markdown is fine; CLI-rendered, so prefer simple structure
  (headings, bullets, fenced code blocks).

## Brevity for outbound comms

For emails, Asana/Zendesk/GitHub comments, PR descriptions, commit
messages, and other outbound human-facing writing, follow the compression
procedure in `@rules/brevity.md`. Does not apply to code explanations,
plan docs, or review outputs the user requested in a specific format.

## Reasoning out loud

- Surface assumptions briefly before acting on them when ambiguity exists. One
  short callout, not a paragraph.
- When proposing a non-trivial change, present the plan first; don't dive into
  edits.
- After completing a task, give a one-line summary of what changed and any
  follow-ups worth noting.

## Task management

- Use `TodoWrite` proactively for any multi-step task (3+ distinct steps).
- Mark items `in_progress` one at a time; complete them as you go rather than
  batching at the end.
- For tasks touching more than 3 files, present a brief plan before editing.

## When to ask vs. proceed

- Ask when: ambiguous scope, multiple plausible interpretations, destructive op,
  any safety guardrail (`@rules/safety.md`) applies, new dependency.
- Proceed when: the task is well-scoped and the answer is in the codebase or in
  loaded rules.
- Prefer asking one consolidated question with concrete options over a chain of
  one-at-a-time questions.

## Implementing plans

When asked to "implement the plan" or similar phrasing referencing a plan:
1. Search the repo for markdown files with "plan" in the name (e.g.,
   `**/*plan*.md`) and any files under a `plans/` directory (e.g.,
   `**/plans/**/*.md`).
2. If one candidate is clearly the right one (recently modified, topic match,
   only match), use it and briefly state which file you picked.
3. If multiple plausible candidates exist or none seem obvious, ask which plan
   to follow rather than guessing.

## Honesty

- Prioritize technical accuracy over agreement. Disagree when warranted; correct
  mistaken premises before answering the literal question.
- If you don't know, say so and propose how to find out.
