# PLAN-ntfy: phone alerts for opencode events via ntfy

> **Status:** implemented; archived 2026-05-06.
>
> Implementation lives in:
> - `opencode/.config/opencode/plugins/notify.ts` — env reads
>   (OPENCODE_IDLE_NTFY_{SERVER,TOPIC,TOKEN}) + parallel notify-send/ntfy fan-out.
> - `opencode/.config/opencode/plugins/notify.lib.ts` — `pingNtfy` (best-effort
>   POST with 5s AbortSignal.timeout, errors swallowed).
> - `opencode/.config/opencode/plugins/notify.test.ts` — automated subset of
>   the Verification list (no-op-when-topic-unset, error swallowing, URL
>   encoding, header construction). Manual phone-push items are annotated
>   inline.
>
> Preserved for decision history.

Augment the existing opencode notify plugin so that, in addition to the
desktop `notify-send` (mako) toast, every notification also pings
[ntfy](https://ntfy.sh) — giving phone alerts for session.idle,
session.error, permission.asked, and question.asked.

## Scope

**Single file changed:** `opencode/.config/opencode/plugins/notify.ts`

No changes to `opencode.json`, `package.json`, `package-lock.json`, the
toggl plugin, or any shell config. No new dependencies — Bun's native
`fetch` is used.

## Decisions (captured from chat)

| Decision              | Choice                                                       |
|-----------------------|--------------------------------------------------------------|
| Events that ping ntfy | All four (idle, error, permission, question)                 |
| Topic configuration   | `OPENCODE_IDLE_NTFY_TOPIC` env var only (no file/1Password)  |
| Default server        | `https://ntfy.sh`                                            |
| Per-event priority    | All events use ntfy default (3) — no Priority header         |

## Design

### Module-level config (read once at plugin module load)

```ts
// unset OPENCODE_IDLE_NTFY_TOPIC ⇒ ntfy disabled (silent no-op);
// OPENCODE_IDLE_NTFY_TOKEN is optional Bearer auth for protected topics.
const OPENCODE_IDLE_NTFY_SERVER = (
  process.env.OPENCODE_IDLE_NTFY_SERVER || "https://ntfy.sh"
).replace(/\/+$/, "")
const OPENCODE_IDLE_NTFY_TOPIC = process.env.OPENCODE_IDLE_NTFY_TOPIC
const OPENCODE_IDLE_NTFY_TOKEN = process.env.OPENCODE_IDLE_NTFY_TOKEN
```

`OPENCODE_IDLE_NTFY_TOPIC` is treated as a secret (anyone who knows it can subscribe to
the alerts) and therefore lives in the environment, not in this public
dotfiles repo. If unset, `pingNtfy` is a silent no-op so machines without
ntfy configured behave exactly as today.

### `pingNtfy` helper

- Uses Bun's native `fetch` — no curl subprocess, no new deps.
- POST `body` (the same plain-text body used for the desktop toast) to
  `${OPENCODE_IDLE_NTFY_SERVER}/${OPENCODE_IDLE_NTFY_TOPIC}`.
- Headers per ntfy publish API:
  - `Title` — same title used for the desktop toast.
  - `Tags` — per-event emoji tag (see table below). Optional.
  - `Authorization: Bearer <token>` — only if `OPENCODE_IDLE_NTFY_TOKEN` is set.
  - `Content-Type: text/plain; charset=utf-8`.
- 5-second `AbortSignal.timeout(5000)` so a stalled ntfy server can't
  block subsequent event handling.
- Wrapped in `try/catch` — best-effort. Mirrors the `.nothrow()`
  philosophy already applied to `notify-send`.

### `notify` wrapper refactor

Existing wrapper signature gains an optional `tags` parameter. Internals
fan out to both transports in parallel:

```ts
const notify = async (
  urgency: "low" | "normal" | "critical",
  title: string,
  body: string,
  tags?: string,
) => {
  await Promise.all([
    $`notify-send -a opencode -u ${urgency} ${title} ${body}`.nothrow(),
    pingNtfy(title, body, tags),
  ])
}
```

`urgency` is unchanged for `notify-send`. ntfy ignores it (no `Priority`
header is sent), per the all-events-priority-3 decision above.

### Per-event tags

Each `case` arm in the existing switch passes a tag string to `notify`.
ntfy renders these as emoji on the phone, making alerts scannable at a
glance.

| Event              | Tag        | Phone emoji |
|--------------------|------------|-------------|
| `session.idle`     | `robot`    | 🤖          |
| `session.error`    | `warning`  | ⚠️          |
| `permission.asked` | `lock`     | 🔒          |
| `question.asked`   | `question` | ❓          |

### Docstring update

Top-of-file docstring expands to cover:

- The four events still fire `notify-send` exactly as before.
- The same four events additionally `POST` to ntfy when `OPENCODE_IDLE_NTFY_TOPIC` is set.
- Env vars: `OPENCODE_IDLE_NTFY_TOPIC` (required), `OPENCODE_IDLE_NTFY_SERVER` (default
  `https://ntfy.sh`), `OPENCODE_IDLE_NTFY_TOKEN` (optional Bearer auth).
- ntfy is best-effort: 5s fetch timeout, errors swallowed, never crashes
  the plugin runtime.
- Priority: every event uses ntfy default (3); change at a single point
  in `pingNtfy` if a louder/quieter alert is ever wanted.

## What this plan does *not* touch

- `~/.bashrc` or any other shell config — `OPENCODE_IDLE_NTFY_TOPIC` setup is left to
  the user (it's a secret, must not be dotfiled).
- `opencode/.config/opencode/opencode.json`, `package.json`,
  `package-lock.json` — no schema/dep changes.
- The unrelated `toggl-time.ts` plugin.

## Verification

Items 1, 2, and 5 are covered by the automated suite at
`opencode/.config/opencode/plugins/notify.test.ts`. Items 3 and 4 are
end-to-end checks that need a real ntfy server + a subscribed phone, so
they remain manual.

1. **No regression when ntfy unset.** `opencode` starts and behaves
   exactly as today when `OPENCODE_IDLE_NTFY_TOPIC` is unset.
   *Automated:* `pingNtfy > no-op when topic is unset`.
2. **Type check / parse.** `notify.ts` still type-checks against
   `@opencode-ai/plugin` (no new TS errors).
   *Automated:* `notify.ts entrypoint > parses cleanly via bun build`.
3. **Idle ping.** With `OPENCODE_IDLE_NTFY_TOPIC` set and the ntfy app subscribed on
   the phone, finishing a turn produces both a mako toast and a 🤖
   phone notification titled with the tmux session name and body
   "Session idle — ready for input". *Manual.*
4. **Permission ping.** Triggering an unapproved bash command produces
   both a mako toast and a 🔒 phone notification with body
   "Permission requested: <detail>". *Manual.*
5. **Resilience.** Pointing `OPENCODE_IDLE_NTFY_SERVER` at a deliberately dead host
   (e.g. `http://127.0.0.1:1`) still leaves the desktop toast working;
   the phone alert is dropped after the 5s timeout without affecting
   subsequent events.
   *Automated:* `pingNtfy > swallows fetch errors / promise rejections`.
