---
description: "Drive a PR's Copilot review to a clean state, or stop blocked on escalate. Reply \"Fixed in <sha>\" to inline comments, re-request via the @copilot reviewer (GraphQL botIds fallback), validate via REST, poll for the new review, and loop until the review body contains \"generated no new comments\" or \"Comments generated: 0 new\"."
agent: build
---

Drive a pull request's Copilot review to a clean state: **reply → re-request → validate → poll → repeat**, exiting on clean (**"generated no new comments"** or **"Comments generated: 0 new"**) **or** stopping blocked (see §6). The re-trigger mechanics are non-obvious: the plain REST call silently no-ops, so follow this sequence exactly rather than improvising. Full background lives in `AGENTS.md` → "GitHub Copilot review re-trigger".

Target PR (a number; else inferred from the current branch): $ARGUMENTS

Current state:

- Branch: !`git branch --show-current`
- PR for this branch: !`gh pr view --json number,url --jq '"#\(.number) — \(.url)"' 2>&1`
- Latest commit (for "Fixed in `<sha>`" replies): !`git log -1 --format='%h %s'`

## 1. Resolve the PR

Use `$ARGUMENTS` as the PR number if given; otherwise take the PR for the current branch (surfaced above). Confirm it is open and that you have the right one before mutating anything.

## 2. Reply to each addressed inline comment

Close the loop on every inline review comment you have actually fixed, so the resolution trail is legible to future human reviewers (per the `AGENTS.md` etiquette note). For each addressed comment, post a brief reply naming the fixing commit:

```
gh api repos/{owner}/{repo}/pulls/<PR>/comments/<comment_id>/replies \
  -f body="Fixed in <sha>"
```

(`gh api` auto-substitutes `{owner}`/`{repo}` from the current repo.) Reply only to comments backed by a real change — don't write "Fixed" against something you haven't touched.

## 3. Re-request the review

**Escalation order. Do NOT use the plain REST `requested_reviewers` POST — it returns 201 but never fires the `review_requested` event, so Copilot never re-reviews.**

1. **First attempt — `gh pr edit`:**

   ```
   gh pr edit <PR> --add-reviewer "@copilot"
   ```

   Note the `@` prefix and lowercase. This is the simple path and usually works the first time.

2. **Fallback — GraphQL `requestReviews` + `botIds`:** if `gh pr edit` stops firing the timeline event (observed mid-loop — possibly rate-limit or bot-state-machine quirk), fetch the PR node id, then call the mutation with Copilot's bot id and `union: true` so it adds to (not replaces) the reviewer set:

   ```
   gh api graphql -f query='
   query { repository(owner: "<owner>", name: "<repo>") {
     pullRequest(number: <PR>) { id } } }'

   gh api graphql -f query='
   mutation {
     requestReviews(input: {
       pullRequestId: "<PR_NODE_ID>",
       botIds: ["BOT_kgDOCnlnWA"],
       union: true
     }) { pullRequest { reviewRequests(first: 5) {
       nodes { requestedReviewer { ... on Bot { login } } } } } }'
   ```

   `botIds` is GraphQL-only — neither REST nor `gh pr edit` exposes it. Copilot's bot node id is `BOT_kgDOCnlnWA` (in the GraphQL block, `<owner>`/`<repo>` must be literal strings, e.g. from `gh repo view --json owner,name`).

## 4. Validate the re-request took

**REST is authoritative; the `gh pr view` wrapper lies about bots.**

- Confirm via REST — Copilot should appear in the `users` array:

  ```
  gh api repos/{owner}/{repo}/pulls/<PR>/requested_reviewers
  ```

- Do **not** trust `gh pr view <PR> --json reviewRequests`: it silently filters out bots and returns `[]` even when Copilot is correctly queued.
- Timeline events lag — wait ~5s before checking. If it never registers, re-attempt step 3, escalating to the GraphQL fallback.

## 5. Poll for the new review

Copilot takes ~3 minutes from `copilot_work_started` to a submitted review. Poll for a fresh review authored by `copilot-pull-request-reviewer`:

```
gh pr view <PR> --json reviews \
  --jq '.reviews[] | select(.author.login=="copilot-pull-request-reviewer") | "\(.submittedAt) \(.state)"'
```

Wait for an entry newer than your re-request before reading the verdict.

## 6. Loop or exit

Triage every new comment against `AGENTS.md` → "GitHub Copilot review re-trigger" → "Escalate, do not auto-accept" before implementing.

- **In-loop** (nits, docs, internal refactors, tests not pinned to a constitution rule) → real fixes, commit, reply "Fixed in <sha>", return to **step 2** with the new sha.
- **Escalate** (would amend `constitution.md`, change user-visible CLI/API/UX, or change a test pinned to a constitution rule) → reply that it is out of loop (needs human/constitution decision). Do not implement. Do not dismiss. If mixed, still apply the in-loop fixes first. Then **stop blocked** (not clean). Do not re-request until the human decides.
- **Clean** → exit when the review **body** contains **either**:
  1. Legacy: **"generated no new comments"** (full signal: "Copilot reviewed N out of N changed files in this pull request and generated no new comments")
  2. New: **"Comments generated: 0 new"** (substring match: `Comments generated: 0 new, 2 resolved` still counts)
- Do **not** exit solely on **"Approval recommended"** or **"No unresolved blocking issues were identified"** (those can sit next to nits).

Stop at clean or blocked. This command only drives the review. **Do not merge**; merging is the caller's explicit, separately-confirmed step.
