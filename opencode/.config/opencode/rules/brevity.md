# Brevity for outbound comms

Compression procedure for emails, Asana/Zendesk/GitHub comments, PR
descriptions, commit messages, and any other outbound human-facing
writing. Does not apply to code explanations, plan docs, or review
outputs the user requested in a specific format.

## When to apply

Only when the first draft exceeds ~3 sentences or ~80 words. Shorter
drafts pass through unchanged — don't ritualize a one-line reply.

## Procedure

1. Write the first draft.
2. Extract into bulleted or numbered lists where possible (the
   "list-extracted" version).
3. Cut the list-extracted version by 50% (by word count) — the "trimmed"
   version.
4. Run a meaning-retention check on each version against the original
   draft (see below). Restore anything lost before presenting.
5. Present both versions side by side, labeled with word counts, and ask
   the user which to use. Do not send either until they pick.

If the list-extracted version is already ~50 words or fewer, the trimmed
version may be too aggressive — still present both, but note that the
trimmed version is the more aggressive cut.

## Meaning-retention check (step 4)

Re-read each compressed version against the original draft. Restore any
dropped:
- action items or next steps
- decisions or recommendations
- questions
- deadlines or dates
- named facts (numbers, IDs, owners)

If something was lost, restore that item and cut elsewhere.

## Email delivery

Brevity changes content, not delivery. For customer-facing mail, still
use `gmail-send --draft` for human review after compressing the body.
