---
name: ui-iteration
description: >-
  Iterate on web UI from the opencode TUI using a Playwright-screenshot
  prototype fan-out loop. Use when the user wants to prototype, explore,
  refine, or visually review UI — components, pages, layouts, design
  variants — in a React + Vite + Tailwind + shadcn project. Renders N
  variant routes, screenshots them across viewports via Playwright MCP,
  describes each, and loops on human feedback. Triggers: "iterate on the
  UI", "prototype a component", "design/redesign this page", "show me a
  few variants", "make it look like <X>", screenshot-based UI review,
  shadcn/Tailwind work. Use ONLY for web UI in this stack; not for
  native/mobile, CLI, or backend tasks.
---

# UI iteration — prototype fan-out

A TUI-native loop for iterating on web UI without leaving opencode. You
generate several React variants, render them in a real browser via
Playwright MCP, screenshot them across viewports, describe the
differences, and let the human steer the next round. opencode stays the
primary interface the whole time — the browser is driven, never touched
by hand.

This skill covers **Phase 1 only: prototype fan-out** (divergent
exploration → human selection). Promoting a winner into the real
component tree, regression baselines, and post-merge fidelity checks are
deliberately out of scope (see [Out of scope](#out-of-scope--deferred)).

## TL;DR

1. Confirm prerequisites (Playwright MCP, shadcn MCP, Vite + React +
   Tailwind + shadcn project, a `DESIGN.md`). See
   [Prerequisite check](#prerequisite-check-run-this-first).
2. Generate `N` (default 3) variants as routes `/proto/v1`, `/proto/v2`,
   … built **only** from existing shadcn primitives.
3. Start (or reuse) the Vite dev server via bash.
4. For each variant: navigate Playwright → resize to each viewport →
   screenshot → detect render failures.
5. Report back: variant list, file paths, screenshot paths, and a short
   description of what makes each one distinct.
6. Human picks a winner, asks for a refined round, or sets a new
   direction. Loop until they ship one. The winner stays at its proto
   route — promotion is a separate, explicit request.

## Prerequisites

- **Playwright MCP** (`@playwright/mcp`) configured and its `browser_*`
  tools available in this session.
- **shadcn MCP** configured (`list_components`, `get_component`,
  `list_blocks`). Without it, component reuse degrades to manual lookup —
  warn the user before proceeding.
- A **Vite + React + Tailwind + shadcn** project in the workspace
  (`vite.config.*`, React in `package.json`, Tailwind configured,
  `components.json` present).
- A **`DESIGN.md`** at the workspace root (or `docs/DESIGN.md`) describing
  tokens, type scale, spacing, and component conventions. Fidelity depends
  on it. If it is missing, stop and resolve first (see prereq check).

MCP config blocks to add to the **project's** `opencode.json` (keep these
heavyweight servers project-scoped, not global, unless you do UI work
constantly):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["npx", "-y", "@playwright/mcp@latest"],
      "enabled": true
    },
    "shadcn": {
      "type": "local",
      "command": ["npx", "-y", "shadcn@latest", "mcp"],
      "enabled": true
    }
  }
}
```

(Confirm the exact shadcn MCP launch command against the installed shadcn
CLI version; the `mcp` subcommand has moved between releases.)

## How to run the loop

1. **Take the brief.** Get a one-line target from the human (e.g. "a
   settings page header with breadcrumbs and a help link"). If they
   handed you a reference image, treat it as the visual target.
2. **Pick `N`.** Default 3 variants. More only on request.
3. **Look up components first.** Before writing any JSX, call shadcn
   `list_components` / `list_blocks` and `get_component` for anything you
   intend to use. Compose primitives; do not hand-roll what already
   exists. See the [project rules block](#project-rules-block-copy-paste).
4. **Write the variants** as isolated routes `/proto/v1` … `/proto/vN`
   (see [Routes & files](#routes--files)). Each variant is self-contained
   and uses only shadcn primitives + Tailwind tokens from `DESIGN.md`.
5. **Start the dev server** (bash). Reuse a running one if present; never
   start a second on a clashing port. See
   [Dev server](#dev-server-bash).
6. **Capture each variant.** For each route, for each viewport:
   `browser_navigate` → `browser_resize` → detect failure → on success
   `browser_take_screenshot` to the [screenshot path](#screenshots). On a
   render failure, fix once and retry; if it still fails, mark it FAILED
   and move on (see [Render-failure handling](#render-failure-handling)).
7. **Report.** Give the human: the variant list, source file paths,
   screenshot paths, and one or two sentences per variant on what makes it
   distinct (from inspecting the screenshot, not from the code you wrote).
8. **Branch on their response:**
   - *"Variant N wins"* → stop. Note the winning route/file. Do **not**
     promote it unless they explicitly ask in a separate step.
   - *Freeform refinement* ("take v2 but tighten spacing, borrow the
     header from v1") → produce a fresh round of `N` variants seeded by
     that feedback; go to step 5.
   - *New direction* ("scrap these, try a sidebar layout instead") →
     discard the round and go to step 2 with the new brief.

---

## Reference

### Workflow shape (Phase 1)

```
1. Human invokes with a description.
2. Produce N variants (default 3) at /proto/v1..vN using shadcn primitives.
3. Start or reuse the Vite dev server. For each variant:
   a. browser_navigate to the route.
   b. browser_resize to each project viewport (default desktop + mobile).
   c. Detect render failure (console errors, Vite overlay, blank snapshot).
   d. On failure: rewrite the variant once, retry. Still failing → mark
      FAILED in the report, continue to the next variant.
   e. On success: browser_take_screenshot to the predictable path.
4. Return: variant list, file paths, screenshot paths, and a short
   vision-derived description of each variant's distinguishing traits.
5. Human responds:
   a. "Variant N wins" → stop. Promotion is a separate, explicit request.
   b. Freeform refinement → new round of N seeded by the feedback, GOTO 3.
   c. New direction → discard the round, GOTO 2 with the new brief.
6. Phase 2 (implementation-fidelity verification) is out of scope: the
   screenshot was rendered from the same code that would ship, so there is
   nothing to re-verify post-selection.
```

### Routes & files

- Variants live as routes `/proto/v1`, `/proto/v2`, … inside the project's
  existing Vite app, with source under a hermetic prototype folder, e.g.
  `src/proto/v<N>.tsx`.
- Wire them into whatever router the app already uses. If there is no
  router, mount a minimal local `/proto` index that renders the variants;
  keep it confined to the prototype folder so it is trivial to delete.
- **Keep prototypes hermetic.** Do not edit shared/production components to
  make a prototype work. A variant that needs a shared-component change is
  feedback for the human, not a license to mutate the real tree.
- **Winner stays put.** The skill's job ends at selection. The winner
  remains at its `/proto/vN` route. Moving it to the real component path,
  deleting the losers, and cleaning the proto index are a separate,
  deliberate request.

### Viewports

Default to two: **mobile 375×812** and **desktop 1280×800**. Add **tablet
768×1024** when the project is responsive-critical or the human asks.
Always prefer the project's actual Tailwind breakpoints over these
defaults when they are known — read them from the Tailwind config or
`DESIGN.md` and capture at representative widths on each side of the
relevant breakpoints.

### Screenshots

- Save under a predictable, local path:
  `.screenshots/proto/round-<n>/v<N>.<viewport>.png`
  (e.g. `.screenshots/proto/round-1/v2.desktop.png`).
- These are **ephemeral review artifacts**, not regression baselines
  (diff strategy is vision-only — see [Decisions](#decisions-log-v1)).
  Add `.screenshots/` to the project's `.gitignore` unless the human wants
  to attach them somewhere.
- Prefer `browser_take_screenshot` only where pixels matter (layout,
  spacing, color). For purely structural questions ("is the breadcrumb in
  the DOM?"), use `browser_snapshot` (accessibility tree) — it is cheaper
  and avoids vision tokens.

### Posting rounds to Asana (API rendering constraints)

Learned the hard way during SH-262.3 (2026-06-11, three rejected
posting formats). If the human wants fan-out screenshots reviewable
on an Asana card, know what the API can and cannot render **before**
posting:

- **Comments can never display images.** Attachments hang off tasks,
  not stories — there is no "attach to a comment" endpoint (see the
  `asana-attach.ts` header in the MASTER-1773 tools repo). Both
  `<a data-asana-gid>` and `<img data-asana-gid>` in a story's
  `html_text` render as plain links in the feed. The `<img>` form is
  extra deceptive: the API *accepts* it and echoes back a fully
  resolved tag (src + thumbnail URLs), but the feed UI still draws a
  bare link. Do not burn a round rediscovering this.
- **True inline images exist only in `html_notes`** (task / project
  descriptions). A description gallery is the only API surface that
  actually renders pictures.
- **Workaround that survives link-rendering:** bake each
  screenshot's label + description into the image itself (header
  band), then post one comment per screenshot with the same text +
  the attachment link (`asana-attach <task> --file <abs-path>
  --comment-file <txt>`). The artifact is self-describing wherever
  it opens — feed link, attachments pane, or download. Band recipe:

  ```bash
  magick -background white -fill '#111827' -font LiberationSans-Bold \
    -pointsize 21 -size 1240x caption:@label.txt l.png
  magick -background white -fill '#374151' -font LiberationSans-Regular \
    -pointsize 15 -size 1240x caption:@desc.txt d.png
  magick l.png \( -size 1240x8 xc:white \) d.png -append \
    -bordercolor white -border 20x16 band.png
  magick band.png \( -size 1280x2 xc:'#cbd5e1' \) shot.png -append out.png
  ```

- **Real image-in-comment bubbles are UI-only.** Only a human pasting
  into the Asana comment box gets them; no API equivalent.
- One comment per screenshot, desktop viewport only (most products
  under iteration here are desktop web apps — check the project's
  `DESIGN.md` screenshot policy).

### Dev server (bash)

Decision 5: drive the dev server with raw bash, not an orchestrator MCP.

- Detect a running server first (check the configured Vite port, e.g.
  `lsof -i :5173` or a quick `curl -sf http://localhost:5173`). Reuse it.
- Otherwise start it detached and capture the URL from its output, e.g.
  `pnpm dev` / `npm run dev` / `bun dev` per the project's package manager.
  Run it in the background so the loop can continue; tear it down only if
  you started it.
- Vite hot-reloads on edit, so subsequent rounds do not need a restart.

### Render-failure handling

Decision 6: auto-retry once, then surface honestly. After navigating to a
variant route, treat it as **failed** if any of these hold:

- `browser_console_messages` shows an uncaught exception or React error.
- A Vite error overlay is present (query for the `vite-error-overlay`
  element via `browser_evaluate`, or spot it in `browser_snapshot`).
- `browser_snapshot` returns an empty / near-empty accessibility tree
  (blank page).

On failure: read the error, fix the variant **once**, and retry. If it
still fails, mark the variant `FAILED (reason)` in the report and continue
to the next variant. Never spin indefinitely, and never hide a failure by
silently dropping the variant.

### Component-reuse discipline (non-negotiable)

This is the heart of the card's "doesn't reinvent components" requirement:

- Call shadcn `list_components` / `list_blocks` and `get_component`
  **before** writing JSX. Reach for an existing primitive or block first.
- Only build a custom component when it is a **composition of existing
  primitives** that does not already exist (e.g. a labelled field group
  built from `Label` + `Input` + `Popover`). Document why in a one-line
  comment.
- Style exclusively with Tailwind utilities and `DESIGN.md` tokens. No
  bespoke CSS files, no inline `style={{…}}`, no magic numbers outside the
  project's spacing/type scale.

### Project rules block (copy-paste)

Decision 8: this skill does not auto-modify project files. Paste the block
below into the target project's `AGENTS.md` (or a project rules file) so
the discipline persists across sessions. It respects the
`project AGENTS.md > global rules > generic defaults` precedence model.

````markdown
## UI work (Vite + React + Tailwind + shadcn)

- Reuse before you build. Call the shadcn MCP (`list_components`,
  `list_blocks`, `get_component`) before writing any component. Only
  create a custom component when it is a composition of existing
  primitives that doesn't already exist; note why in a comment.
- Style with Tailwind utilities and tokens from `DESIGN.md` only. No
  bespoke CSS, no inline styles, no magic numbers outside the spacing /
  type scale.
- Prototype work is hermetic: variants live at `/proto/vN` under
  `src/proto/`. Never edit shared/production components to satisfy a
  prototype — surface the needed change as feedback instead.
- Visual review is screenshot-driven via Playwright MCP. Capture at the
  project's breakpoints (default mobile 375 + desktop 1280).
- Keep `.screenshots/` out of git unless deliberately archiving a round.
````

### DESIGN.md template (copy-paste)

If the project has no `DESIGN.md`, offer to seed one from the existing
Tailwind config + shadcn theme, or have the human fill this in:

````markdown
# DESIGN.md

## Brand & tone
One or two sentences on the product's visual personality.

## Color tokens
Map semantic roles to the Tailwind/shadcn CSS variables actually in use
(`--background`, `--foreground`, `--primary`, `--muted`, `--destructive`,
…). Do not invent hex values that bypass the token system.

## Typography
Font families, the type scale (e.g. `text-sm`/`text-base`/`text-lg` usage
rules), heading hierarchy, line-height conventions.

## Spacing & layout
The spacing scale in use, container widths, grid/gutter conventions,
default radii and shadows.

## Components
Which shadcn primitives are standard for which jobs (e.g. "forms use
`Form` + `Input` + `Label`; never a raw `<input>`"). Known custom
compositions and where they live.

## Breakpoints
The project's responsive breakpoints and which viewports to screenshot.

## Do / Don't
A short list of project-specific UI rules the agent must respect.
````

### Prerequisite check (run this first)

Before generating anything, verify and resolve:

1. **Playwright MCP** — are `browser_navigate` / `browser_take_screenshot`
   available? If not, tell the user to add `@playwright/mcp` (see
   [Prerequisites](#prerequisites)) and stop.
2. **shadcn MCP** — are `list_components` / `get_component` available? If
   not, warn that component reuse degrades to manual lookup; proceed only
   if the user accepts.
3. **Stack** — `vite.config.*` present, React in `package.json`, Tailwind
   configured (v3 `tailwind.config.*` or v4 `@import "tailwindcss"` in
   CSS), and shadcn installed (`components.json`). If a piece is missing,
   surface exactly which one and stop.
4. **`DESIGN.md`** — present at root or `docs/`? If missing, offer to
   extract one from the existing tokens/theme using the
   [template](#designmd-template-copy-paste), or ask the user to create
   one. Do not proceed without it — fidelity depends on it.

### Decisions log (v1)

Settled during the 2026-06-10 design conversation (source:
`investigations/2026-06-10-opencode-ui-iteration-workflows.md`).

| # | Decision | Rationale (short) |
|---|----------|-------------------|
| 1 | Stack: Vite + React + Tailwind + shadcn | Per the card; Vite specifically for the dev server. |
| 2 | Diff strategy: vision-model only | Pixel diff is a regression-over-time tool; under fan-out it is tautological for the immediate ship. Pixelmatch deferred. |
| 3 | Phase 1 (fan-out) only in scope | Phase 2 fidelity is moot by construction; Phase 3 regression is a future card. |
| 4 | Asana posting deferred | The Asana MCP can comment but cannot upload attachments (REST-only). v1 produces local screenshots only. |
| 5 | Browser driver: raw `@playwright/mcp` + bash dev server | Official MCP, lowest schema overhead; variants share one Vite server so an orchestrator MCP adds little. |
| 6 | Render errors: auto-retry once, then surface honestly | Catches typos without spinning forever or hiding failures. |
| 7 | Winner placement: variants stay at `/proto/vN` | Skill ends at selection; promotion is a separate, deliberate request. Keeps prototypes hermetic. |
| 8 | Rules: SKILL ships a copy-paste block; skill verifies prereqs, never auto-edits project files | Respects the existing precedence model; prereq check catches the painful misses. |

### Out of scope / deferred

- **Phase 2 — implementation fidelity.** Moot here: the screenshot is
  rendered from the same code that ships.
- **Phase 3 — visual regression / pixelmatch baselines.** Revisit if drift
  becomes a real problem; its own future card.
- **Asana attachment posting.** Resolved in practice via the
  `asana-attach` REST helper (MASTER-1773 tools) — but read
  [Posting rounds to Asana](#posting-rounds-to-asana-api-rendering-constraints)
  for what the API will and will not render before using it.
- **Greenfield ideation on-ramps** (Claude Design export-bundle handoff,
  Stitch round-tripping). Candidate sibling skill
  `ui-from-claude-design/` if a concrete need emerges. Both were evaluated
  and deprioritized because they are not TUI-driven; see the investigation
  doc.
- **Promotion / cleanup of the winning variant** into the production tree.

### Cross-references

- Design + option analysis: `investigations/2026-06-10-opencode-ui-iteration-workflows.md`
- Asana card MASTER-1774 — "Document how to iterate on UI tasks within opencode".
- Anthropic Claude Code best practices (the canonical visual-verification
  loop this skill is modeled on): <https://code.claude.com/docs/en/best-practices>
- Microsoft Playwright MCP (with opencode config snippet): <https://github.com/microsoft/playwright-mcp>
