# OpenCode UI Iteration Workflows

**Date**: 2026-06-10
**Status**: SKILL.md authored at `opencode/.config/opencode/skills/ui-iteration/SKILL.md` (uncommitted, MASTER-1774 worktree). Next: validate on a real Vite + React + Tailwind + shadcn project, then publish.
**Related**: Asana MASTER-1774 — "Document how to iterate on UI tasks within opencode"
**Scope**: Web UI only (React + Vite + Tailwind + shadcn). Other surfaces explicitly out of scope.

> **Progress** (2026-06-10, updated): the skill is **authored** at
> `opencode/.config/opencode/skills/ui-iteration/SKILL.md` (stow-mapped to
> `~/.config/opencode/skills/ui-iteration/SKILL.md`; auto-discovered as a global skill once
> merged + stowed + opencode restarted). It implements the **Workflow shape (Phase 1:
> prototype fan-out)** spec and all 8 entries of the **Decisions (v1 design)** table below,
> plus a copy-paste project-rules block, a `DESIGN.md` template, and a prereq check.
> To resume: validate the skill on a real Vite + React + Tailwind + shadcn project, then
> publish to the public dotfiles repo. Side-note still pending (unrelated to this card):
> Opus 4.7+ rejects opencode's default thinking config (deprecated `thinking.type.enabled`);
> a fix for `~/.config/opencode/opencode.json` (override the `claude-opus-4-7`/`-4-8`
> variants to `thinking.type=adaptive` + `effort`) — apply whenever convenient.

## Executive Summary

The card asks for a workflow that lets opencode drive UI iteration end-to-end from the TUI, follows design best practices, tracks revisions, supports rapid review-iteration loops, and stays inside existing component kits (shadcn/Tailwind) rather than reinventing components. Three options were evaluated:

1. **Claude Design** (Anthropic Labs) — browser-only at `claude.ai/design`. **Cannot be driven from a TUI.** Produces a "handoff bundle" tarball that opencode/Claude Code can consume one-direction.
2. **Stitch** (Google Labs) — has an MCP server and Skills SDK so opencode can call it programmatically, but the canvas itself still lives in a browser; the round-trip (code ↔ canvas) is the value, not a TUI-first loop.
3. **Playwright MCP + screenshot-driven feedback loop** — fully TUI-native. opencode runs a dev server, takes screenshots via Playwright MCP, compares against a target image or design spec, edits code, repeats. Anthropic's own Claude Code best-practices doc treats this pattern as the canonical visual-verification loop.

**Recommendation**: make the **Playwright MCP + screenshot loop** the default UI iteration workflow, captured as an `opencode/skills/<name>/SKILL.md` skill in a follow-up. Keep **Claude Design** as an opportunistic on-ramp for greenfield design ideation (export bundle → feed to opencode). **Stitch** is interesting but adds a tool/account and overlaps significantly with the screenshot loop's strengths; deprioritize unless a future need (e.g. sharing designs with non-engineers) emerges.

The dealbreaker against Claude Design and (to a lesser extent) Stitch is the explicit card constraint: *"opencode can drive it and remains my primary interface for inputs."* Browser-based canvases violate that even when they have a code/MCP bridge.

---

## The Card's Desirables (evaluation criteria)

| # | Desirable | Test |
|---|-----------|------|
| 1 | Works within opencode TUI workflows; opencode drives it; opencode remains primary input | Can the workflow be initiated, iterated, and completed without leaving the TUI? |
| 2 | Intelligently follows design best practices | Does the tool ingest a design system / DESIGN.md / brand tokens and apply them automatically? |
| 3 | Systematically makes revisions with change history | Are changes auditable (git, internal versioning) and reversible? |
| 4 | Geared toward rapid iterations for quick human reviews | How short is the edit → render → review loop? |
| 5 | Uses existing design kits, stays within tight design boundaries | Does it default to shadcn/Tailwind primitives rather than generating bespoke markup/CSS? |
| 6 | Doesn't like to reinvent components | Will it compose existing components instead of writing new ones? |
| 7 | Skill content is non-sensitive, publishable to public dotfiles | No client data or proprietary tooling required |

---

## Option 1: Claude Design (Anthropic Labs)

**Released**: 2026-04-17
**Surface**: `claude.ai/design` — web only (Chrome/Safari/Edge/Firefox). Not in Claude Desktop. **No CLI, no MCP, no API as of June 2026.**
**Underlying model**: Claude Opus 4.7 (vision-capable).

### Capabilities

- Generates **interactive, code-backed** prototypes (not static images) — clickable, hoverable, scrollable.
- During onboarding, ingests your codebase + design files to extract a design system (colors, typography, spacing, components) and applies it to every project.
- Refinement: chat, inline comments on specific elements, direct text edits, custom adjustment sliders the model creates per project.
- Imports: text prompt, images, DOCX/PPTX/XLSX, codebase pointer, web-capture tool that grabs elements from a live URL.
- Exports: Canva, PDF, PPTX, standalone HTML, **handoff bundle** (tar archive containing rendered HTML + a `README` instructing a coding agent to match the visual output in whatever stack the codebase uses).
- Org-scoped sharing; private/view/edit access levels; group conversations with the model.

### Fit against desirables

| # | Desirable | Verdict | Notes |
|---|-----------|---------|-------|
| 1 | TUI-driven | **Fails** | Browser only. Workflow forces a tab-switch out of opencode for the design phase. The handoff bundle is one-direction (design → opencode); there is no way to stay in opencode while iterating on the design itself. |
| 2 | Best-practice / design system | Strong | Codebase-aware design system extraction is the headline feature. |
| 3 | Change history | Weak | Internal versioning inside Claude Design, separate from git. |
| 4 | Rapid iteration | Strong | Sliders + inline edits are tight. But the loop ends at the export step; once you're in opencode you're in a different loop. |
| 5 | Existing kits | Strong | Reads your codebase to learn shadcn/Tailwind conventions. |
| 6 | Doesn't reinvent | Strong | Same — codebase-aware. |
| 7 | Publishable skill | OK | Tooling itself isn't sensitive; usage instructions are fine to publish. |

### Cost considerations

- Subscription-gated: Pro / Max / Team / Enterprise. Not free.
- Heavy token usage: third-party reviews (Garima Agarwal, Apr 2026) report two design sessions consuming ~50–60% of a Pro plan's *weekly* quota. Some users hit 80–90% in a single complex prototype session. Plan sessions deliberately.

### Where it fits

- **Greenfield ideation**: when starting from a brief or external design reference and you want a fast first-pass before involving opencode at all.
- **Stakeholder review artifact**: Canva/PDF/PPTX exports for non-engineers.
- **One-direction handoff**: export bundle → unpack into the repo → opencode reads the bundle and matches it in your existing stack.

It does not satisfy the "opencode drives it" requirement. Use as a complement, not a default.

---

## Option 2: Stitch (Google Labs)

**Major redesign**: 2026-03-18 — now an "AI-native infinite design canvas".
**Surface**: `stitch.withgoogle.com` (web canvas) **+ MCP server + Skills SDK** for programmatic access.
**Underlying model**: Gemini.

### Capabilities

- Infinite-canvas design environment with a design-agent that tracks progress and accepts voice/text/image/code as input.
- **DESIGN.md** — agent-friendly markdown format describing design rules (colors, typography, spacing, etc.) that's portable across tools. Stitch can extract one from a URL and import/export it.
- **Stitch MCP server** (`@google-labs/stitch-mcp`, plus community variants `LuciferDono/stitch-pro-mcp`, `oogleyskr/stitch-mcp-server`) exposes tools for screen generation, code↔design conversion, design system management, and React/Vue/Svelte/React-Native export.
- **Stitch Skills SDK** — `google-labs-code/stitch-skills` repo provides ready-made skills: `stitch::code-to-design`, `react-components`, `shadcn-ui`, `stitch-loop`, `taste-design`. The `shadcn-ui` skill is a notable reference: it expects the shadcn MCP server to be present and uses `get_component`, `list_blocks`, etc. to compose existing primitives.
- Exports HTML → React/TSX with Tailwind+shadcn (via `stitch-pro-mcp`'s `sp_to_react` tool with shadcn variant mapping and CVA), plus Vue, SvelteKit, React Native.
- Design system tools: extract from URL, apply to existing HTML (CSS variable injection, font/color enforcement).

### Fit against desirables

| # | Desirable | Verdict | Notes |
|---|-----------|---------|-------|
| 1 | TUI-driven | **Partial** | The MCP enables programmatic invocation from opencode, but the canvas itself is in a browser. The workflow is round-tripping: opencode → Stitch (visual) → opencode. Better than Claude Design, still not TUI-end-to-end. |
| 2 | Best-practice / design system | Strong | DESIGN.md + design system extraction tools. |
| 3 | Change history | Weak | Internal Stitch versioning; export to git is manual. |
| 4 | Rapid iteration | Medium | Canvas iteration is fast, but the round-trip cost (export → opencode → re-import) adds friction. |
| 5 | Existing kits | Strong | shadcn skill is mature; `sp_extract` maps HTML elements to shadcn/Radix/MUI components with confidence scoring. |
| 6 | Doesn't reinvent | Medium | Better at composing than greenfield generation, but the canvas tendency is to generate rather than compose. Mitigated by good prompts and design-system enforcement. |
| 7 | Publishable skill | OK | Stitch itself is free public tooling. |

### Cost considerations

- Free public tool; pay-per-Gemini-call when used heavily.
- MCP server adds setup steps (install, configure, manage credentials).

### Where it fits

- **Code → design round-tripping**: when you need to share an existing UI as a Stitch project for non-engineer review/edit (`stitch::code-to-design`).
- **Multi-screen flow generation**: when designing several connected screens at once.
- **Adoption friction is the main blocker**: another tool, another account, another MCP. Worth evaluating only if a concrete need demands it.

---

## Option 3: Playwright MCP + screenshot-driven feedback loop

This is the pattern Anthropic's own [Claude Code best-practices doc](https://code.claude.com/docs/en/best-practices) treats as the canonical visual-verification loop. The user's quote there:
> "Verify UI changes visually" → "[paste screenshot] implement this design. take a screenshot of the result and compare it to the original. list differences and fix them"

### Surface

Pure TUI — opencode is the primary interface throughout.

- **Playwright MCP** (`@playwright/mcp`) — official, supported in opencode via `opencode.json` MCP config. Tools: `browser_navigate`, `browser_snapshot` (accessibility tree, the LLM-friendly default), `browser_take_screenshot`, `browser_click`, `browser_type`, `browser_resize`, `browser_evaluate`, `browser_console_messages`, etc.
- **Alternative**: `heimoshuiyu/opencode-browser-plugin` — opencode-native plugin that exposes the same Playwright capabilities as a single `browser` tool with sub-actions, persistent profile at `~/.opencode/browser-profile`, idle auto-close.
- **Higher-level wrappers** (optional): `thomasbunch/feedback` MCP (web/Electron/Tauri/Windows app launcher + screenshot + workflow runner with assertions), `nathanwjclark/claude-code-app-screenshot-tester` (sequential capture, key-frame detection, visual regression).

### Canonical loop

```
1. Have target — a screenshot, design spec markdown (DESIGN.md), or "make X look like Y" prompt.
2. opencode edits code (component, Tailwind classes, etc.) using existing shadcn primitives.
3. dev server hot-reloads (Vite/Next/etc.).
4. Playwright MCP takes a screenshot at the relevant viewport(s).
5. opencode visually inspects the screenshot:
   - against the target image (pixel diff via pixelmatch, or visual reasoning by Opus 4.7+),
   - or against the spec (does it match the described layout?).
6. List concrete differences. Edit. Goto 4.
7. Stop when differences are gone or human says ship.
```

The **opencode `general` agent + an effort-`xhigh` Opus 4.8** is well-suited: vision capable, persistent enough to run the loop autonomously, cheap enough to iterate freely.

### Fit against desirables

| # | Desirable | Verdict | Notes |
|---|-----------|---------|-------|
| 1 | TUI-driven | **Strong** | End-to-end in opencode. The browser opens, but you don't interact with it — Playwright does. |
| 2 | Best-practice / design system | Medium → Strong with rules | Doesn't ship with a design system; fidelity comes from a `DESIGN.md` + project rules + the user's existing component library. The skill doc must require these. |
| 3 | Change history | **Strong** | Git-native. Screenshots can be committed as fixtures. Diffs are commit diffs. |
| 4 | Rapid iteration | Strong | Tight loop once set up. Per the Anthropic best-practices and multiple practitioner reports (Boris Cherny's "verification beats prompting" observation, Tal Rotbart's round-trip post), this is what produces hours-long autonomous sessions. |
| 5 | Existing kits | Strong | The agent edits *your* code; whatever kit you use, that's what gets used. |
| 6 | Doesn't reinvent | **Strong** | Edits over generates. Pair with shadcn MCP for component lookup (`list_components`, `get_component`, `list_blocks`) and the agent will reach for existing primitives. |
| 7 | Publishable skill | **Strong** | All tooling is open-source; no credentials, no client data. |

### Cost considerations

- **No tool subscription** beyond what opencode already costs.
- Vision-model token cost per screenshot inspection — material on Opus 4.8 with `effort: xhigh`. Mitigations: prefer `browser_snapshot` (accessibility tree, no pixels) for structural checks; reserve `browser_take_screenshot` for layout/spacing/visual checks where pixels actually matter; resize/compress screenshots to WebP before sending (the `feedback` MCP does this automatically).
- Setup cost: one-time MCP install + a project `DESIGN.md` + a SKILL.md to encode the loop.

### Open design choices for the eventual SKILL.md

- Pixel diff (deterministic, requires baseline) vs. vision-model diff (flexible, fuzzy)? Probably both: pixel diff for regression, vision diff for new features.
- Where do baselines live? Suggest `.screenshots/<route>/<viewport>.png` checked into git.
- How does the skill detect when to stop? Convergence on diff threshold, or explicit "approved" turn from human, or `/goal` condition + stop hook.
- Should the skill require shadcn MCP? Probably yes for web UI work — its `list_components`/`get_component` tools force component-reuse.
- Multi-viewport policy: `375` mobile, `768` tablet, `1280` desktop? Or just record what the project's responsive breakpoints actually are?

---

## Comparison matrix

Symbol legend: ✅ strong fit, ⚠️ partial, ❌ doesn't satisfy.

| Desirable | Claude Design | Stitch | Playwright + screenshot loop |
|---|:---:|:---:|:---:|
| 1. TUI-driven, opencode primary | ❌ | ⚠️ | ✅ |
| 2. Design best practices baked in | ✅ | ✅ | ⚠️ (requires explicit rules) |
| 3. Systematic revisions w/ history | ⚠️ (internal, not git) | ⚠️ (internal, not git) | ✅ (git-native) |
| 4. Rapid iteration for review | ✅ (sliders) | ✅ (canvas) | ✅ (loop) |
| 5. Stays within shadcn/Tailwind | ✅ (codebase-aware) | ✅ (shadcn skill) | ✅ (edits your code) |
| 6. Doesn't reinvent components | ✅ | ⚠️ | ✅ (with shadcn MCP) |
| 7. Publishable / non-sensitive | ✅ | ✅ | ✅ |
| **Setup cost** | None (account only) | Medium (MCP, account, skills) | Low (one MCP, one skill) |
| **Recurring cost** | High (subscription + token-heavy) | Medium (Gemini calls) | Low (vision tokens during loops) |
| **Greenfield ideation** | ✅ | ✅ | ⚠️ |
| **Refinement on existing UI** | ⚠️ | ⚠️ | ✅ |

---

## Recommendation

### Default workflow

**Playwright MCP + prototype fan-out loop**, captured as `opencode/.config/opencode/skills/ui-iteration/SKILL.md` (name settled: `ui-iteration`; **authored** 2026-06-10). The skill should:

- Require `@playwright/mcp` configured in opencode.json.
- Require shadcn MCP configured for web UI projects.
- Require a project-level `DESIGN.md` in the workspace it operates in (no DESIGN.md → ask the user to create one or extract one).
- Encode the prototype-fan-out workflow (Phase 1; see "Workflow shape" below).
- Specify multi-viewport defaults and how to override per project.
- Explicitly forbid generating bespoke components when shadcn primitives exist (force `list_components`/`get_component` calls first).

### Workflow shape (Phase 1: prototype fan-out)

```
1. Human invokes skill with a description ("a settings page header with breadcrumbs and a help link").
2. Skill produces N React component variants (default N=3) at routes /proto/v1, /proto/v2, ...
   under the project's existing Vite app, using shadcn primitives.
3. Skill starts the Vite dev server (or reuses one running), then for each variant:
   a. Navigates Playwright to the route.
   b. Resizes to the project's viewports (default desktop + mobile).
   c. Takes screenshots, saves to a predictable local path.
   d. If render fails (TS/runtime/blank-page detection): rewrite the variant once, retry. If it
      still fails, mark the variant as failed in the report and continue to the next.
4. Skill returns to the human with: a list of variants, file paths, screenshots, and a short
   vision-model-generated description of each variant's distinguishing characteristics.
5. Human reviews. Three possible responses:
   a. "Variant N wins" — skill stops. Promotion to the real component is a separate, deliberate
      request (out of skill scope).
   b. "Refine X with Y from Z" or other freeform feedback — skill produces another round of
      N variants seeded by the feedback, GOTO 3.
   c. "Throw all of these out, here's a new direction" — skill discards the previous round,
      GOTO 2 with the new direction.
6. Phase 2 (implementation fidelity) is not in scope; by construction the screenshot was
   rendered from the same code that ships, so there's nothing meaningful to verify post-merge.
```

### On-ramps and adjacencies

- **Claude Design** for greenfield ideation. Document the export-bundle handoff as a separate sub-flow in the same skill (or a sibling skill `ui-from-claude-design/SKILL.md`). One-direction: Claude Design → opencode, never the reverse.
- **Stitch** is deferred. Revisit if a concrete need emerges (sharing designs with non-engineers, multi-screen flow generation, etc.).

---

## Decisions (v1 design)

These are the answers chosen during the design conversation on 2026-06-10. They define the v1
scope of the skill and resolve the prior "open questions" section.

| # | Decision | Rationale (short) |
|---|----------|-------------------|
| 1 | **Stack: Vite + React + Tailwind + shadcn** | Per the card. Vite specifically for the dev server. |
| 2 | **Diff strategy: vision-model only** | Pixel diff is a regression-over-time tool; under prototype fan-out it's tautological for the immediate ship. Pixelmatch is deferred to a follow-up if regressions become a real problem. |
| 3 | **Phase 1 only in scope** | Phase 2 (implementation fidelity) is moot by construction (the screenshot was rendered from the same code). Phase 3 (regression) is its own future card. |
| 4 | **Asana integration: deferred** | Asana MCP can post comments but cannot upload attachments (REST-API-only). Punt to a follow-up. v1 produces local screenshots only. |
| 5 | **Browser driver: raw `@playwright/mcp` + bash for dev server** | Microsoft's official MCP, blessed by opencode docs. Lowest schema overhead vs. orchestrator MCPs. Easier to swap later if friction emerges. Variants live as routes inside one Vite dev server, so the dev-server-lifecycle advantage of `feedback` MCP is small. |
| 6 | **Variant render errors: auto-retry once, then surface honestly** | Catches typos and trivial errors automatically without spinning forever or hiding failures. |
| 7 | **Winner placement: variants as routes; winner stays put** | Variants live at `/proto/v1`, `/proto/v2`, etc. Skill's job ends at selection. Promotion to the real component path is a separate, deliberate request — keeps prototype work hermetic. |
| 8 | **Rules location: SKILL.md ships a copy-paste rules block; skill verifies prereqs** | Respects the existing `project AGENTS.md > global rules > generic defaults` precedence model. Skill does not auto-modify project files. Prereq check at invocation catches the painful misses (missing shadcn install, no Tailwind config, no DESIGN.md). |

### Deferred to follow-ups

- Pixelmatch regression layer (when a concrete regression problem materializes).
- Asana posting integration (likely needs a `~/src/bamboo/tools` Asana REST helper, which is its own project).
- Implementation-fidelity verification (Phase 2) — only revisit if drift between accept-screenshot and merged-render becomes a real issue.
- `ui-from-claude-design/` sibling skill for Claude Design handoff bundles.

---

## Next steps

1. Review and edit this doc (you).
2. ~~Author `opencode/skills/<name>/SKILL.md` per the v1 decisions above.~~ **Done** 2026-06-10 — `opencode/.config/opencode/skills/ui-iteration/SKILL.md`.
3. Validate the skill on a real project (suggest: a sandbox Vite + React + Tailwind + shadcn app, or a Bamboo customer worktree with that stack already in place).
4. Once stable, promote and publish in the public dotfiles repo.

---

## References

### Claude Design
- Anthropic announcement: https://www.anthropic.com/news/claude-design-anthropic-labs (2026-04-17)
- Claude Help Center — design system setup: https://support.claude.com/en/articles/14604397-set-up-your-design-system-in-claude-design
- Garima Agarwal — practical workflow review: https://www.designsystemscollective.com/claude-design-the-complete-setup-workflow-guide-2026-5de41e62fd4c
- Victor Dibia — engineering-perspective evaluation: https://newsletter.victordibia.com/p/how-good-is-anthropics-claude-design

### Stitch
- Google Blog — relaunch announcement: https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-ai-ui-design/ (2026-03-18)
- Official skills repo: https://github.com/google-labs-code/stitch-skills
- shadcn skill (reference for our own skill structure): https://github.com/google-labs-code/stitch-skills/tree/main/skills/shadcn-ui
- Community MCP — `stitch-pro-mcp`: https://github.com/LuciferDono/stitch-pro-mcp-server
- Community MCP — `stitch-mcp-server`: https://github.com/oogleyskr/stitch-mcp-server
- Workflow template — Stitch + React + Puppeteer validation: https://github.com/krzemienski/stitch-design-to-code

### Playwright + screenshot loop
- Anthropic Claude Code best practices: https://code.claude.com/docs/en/best-practices
- Boris Cherny — "verification beats prompting": https://blog.vibecoder.me/verification-beats-prompting-claude-code-boris-cherny
- Microsoft Playwright MCP: https://github.com/microsoft/playwright-mcp (with explicit opencode config snippet)
- opencode-browser-plugin (opencode-native): https://github.com/heimoshuiyu/opencode-browser-plugin
- thomasbunch/feedback MCP: https://github.com/thomasbunch/feedback
- "Eyes" Visual Feedback Loop skill: https://mcpmarket.com/tools/skills/visual-feedback-loop-eyes
- Tal Rotbart — round-trip screenshot testing: https://medium.com/@rotbart/giving-claude-code-eyes-round-trip-screenshot-testing-ce52f7dcc563
- Egghead — AI-driven design workflow w/ Playwright + pixelmatch: https://egghead.io/ai-driven-design-workflow-playwright-mcp-screenshots-visual-diffs-and-cursor-rules~aulxx
- Kent Tokyo — pre-Claude-Code design prep: https://dev.to/kent-tokyo/what-i-do-before-letting-claude-code-touch-web-app-design-53n0
- Builder.io — Claude Code preview/auto-verify: https://www.builder.io/blog/claude-code-visual-editor
