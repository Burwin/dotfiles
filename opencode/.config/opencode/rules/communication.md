# Communication Style

How to talk to the user and structure responses.

## Format

- Use `file_path:line_number` when referencing a specific function, type, or
  line of code, so the user can jump to it directly.
- Be concise. Short answers to short questions. Expand only when warranted.
- Plain prose only. No emoji unless explicitly requested.
- GitHub-flavored markdown is fine; CLI-rendered, so prefer simple structure
  (headings, bullets, fenced code blocks).

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

## Honesty

- Prioritize technical accuracy over agreement. Disagree when warranted; correct
  mistaken premises before answering the literal question.
- If you don't know, say so and propose how to find out.
