---
name: no-ai-tells
description: >-
  humanize text; strip AI tells and em dash patterns. Use when the user
  asks to humanize, remove AI tells, strip em dashes, or make prose less AI.
---

# No AI tells (humanize)

On-demand rewrite: strip AI prose tells while keeping every fact from the
source. Complements the always-loaded `rules/no-ai-tells.md` (lean ban + top
tells for all agent prose). This skill adds process, modes, and a fuller
pattern checklist. Same bans and exemptions as the rule; nothing here
weakens them for ordinary agent writing.

Distilled from [Wikipedia:Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)
and [blader/humanizer](https://github.com/blader/humanizer) (MIT). Short
distill, not a wholesale copy.

## Scope and exemptions

**In:** agent-written or user-supplied prose the user wants humanized
(chat paste, file, outbound draft).

**Exempt (leave untouched):** code, logs, quotes, user samples (same four as
the rule), plus frontmatter, data, and link targets when rewriting a file.
"User samples" means material under discussion, not the rewrite target.

**Voice-sample override:** if the user supplies their own writing as a style
model, match its habits (sentence length, punctuation, recurring phrases).
That sample outranks the dash ban only when the sample itself uses those
dashes; match frequency, do not invent more. Override applies only inside
this skill's rewrite; it does not relax the always-loaded rule elsewhere.

## Hard ban (dashes)

Final rewrite has no em dash, en dash, or prose double-hyphen (same ban as
the rule). Show banned shapes only in examples; instructional prose uses
periods, commas, colons, or parentheses.

```
word — more
word – more
word -- more
```

Replace with a period, comma, colon, parentheses, or a restructure. Before
hand-off, scan the final text for the banned characters above; any hit means
revise again (unless voice-sample override applies).

## Process

Always run all four steps. Modes below change only input and what you
surface; they do not skip steps.

1. **Identify:** scan source for dash abuse and patterns below. For style
   patterns (vocab, inflation, tics), clusters beat isolated hits. The hard
   ban still applies to every dash in the final rewrite unless voice-sample
   override applies.
2. **Draft rewrite:** preserve every claim, name, number, date, quote, and
   citation from the source. Compress dull parts; keep specifics. Prefer
   is/are/has over ornate stand-ins. Vary sentence length.
3. **Audit ("still AI?"):** ask briefly: what still reads as obviously AI
   generated? Does the draft state any fact not in the source?
4. **Final:** fix audit hits; confirm no banned dashes (unless sample
   override); deliver per mode below.

### No fabrication

Never add facts, names, numbers, dates, quotes, or citations that are not
in the source (or explicitly supplied by the user). Vague claims stay vague
or get cut; do not invent specifics to sound human. Opinions/stance are
voice only when the genre calls for it (blog, essay); stay neutral for
technical, legal, and reference prose.

## Invocation modes

- **Pasted text (default):** user pastes prose in chat. Surface draft, short
  "still AI?" audit bullets, then final rewrite.
- **File:** user points at a path. Run the loop; write only the final text
  into the file (prose humanized; code/frontmatter/links untouched). In chat,
  report a short change summary, not the full body.
- **Embedded:** another task uses this skill as one step. Run the loop
  internally; output only the final prose. No draft, no audit bullets, no
  summary.

## Pattern checklist

Fuller than the always-loaded rule (which keeps the top five only). Fix when
clustered; do not gut clean human prose for a single weak hit.

### Content

- **Significance inflation:** "stands as a testament", "pivotal role",
  "underscores the importance", "evolving landscape". State the fact; skip
  the pedestal.
- **Promotional tone:** nestled, vibrant, breathtaking, renowned,
  groundbreaking (figurative), must-visit. Neutral nouns and verbs.
- **Vague attribution:** "experts say", "observers note", "industry
  reports" with no named source. Name the source or cut.
- **Formula sections:** "Despite challenges… continues to thrive",
  Challenges and Future Prospects boilerplate. Keep concrete problems only.
- **-ing depth tack-ons:** "…, highlighting/ensuring/symbolizing…". End the
  sentence; drop the fake analysis clause.

### Language

- **AI vocab:** delve, tapestry, testament, landscape (abstract), pivotal,
  showcase, underscore, intricate, foster, garner, vibrant, crucial (and
  cousins). Plain words.
- **Negative parallelism:** "It's not X, it's Y" / "not just X but Y" /
  tailing "no guessing". Say the positive claim once in a full clause.
- **Rule of three:** forced triples for rhythm. One concrete point.
- **Copula avoidance:** "serves as", "boasts", "features" where "is"/"has"
  works.
- **Passive / subjectless:** "No config needed"; "results are preserved".
  Put the actor back when clearer.
- **Elegant variation:** synonym cycling for the same noun every sentence.
  Repeat the clear word.
- **False ranges:** "from X to Y" when X and Y are not on a scale.
- **Filler:** "in order to", "due to the fact that", "it is important to
  note that". Cut to the clause that carries meaning.
- **Hedging pile-up:** could potentially possibly might. One modal is
  enough.
- **Signposting:** "Let's dive in", "here's what you need to know". Do the
  thing; do not announce it.

### Style and chat

- **Chatbot tics:** "Hope this helps!", "Let me know if you have
  questions", "Great question!", "You're absolutely right!". End when the
  answer ends.
- **Boldface spam / inline-header lists:** mechanical **Label:** blurbs.
  Prefer ordinary sentences or plain lists.
- **Emoji decoration** on headings or bullets. Remove.
- **Curly quotes** (“…”) as a chatbot default. Prefer straight "…" unless
  the source or house style requires curly.
- **Title Case Headings** for ordinary sections. Sentence case.
- **Generic upbeat closer:** "exciting times lie ahead". End on the last
  concrete fact.
- **Staccato drama / aphorism formulas:** stacked one-line punchlines; "X
  is the Y of Z". Ordinary claims in ordinary rhythm.
- **Theatrical openers:** "Honestly?", "Here's the thing," as fake-candid
  hooks. Just state the point.

## False positives (do not over-edit)

Polish, formal vocabulary, one transition word, one short emphatic
sentence, letter-style sign-off, or curly quotes alone do not prove AI.
Prefer clusters. Preserve specific hard-to-fake detail, mixed feelings,
uneven rhythm, and genuine asides.

## Reference

- Always-loaded companion: `rules/no-ai-tells.md`
- https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing
- https://github.com/blader/humanizer (MIT)
