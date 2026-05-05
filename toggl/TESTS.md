# toggl-set tests

Manual smoke tests for the `toggl-set` CLI. Each case below is a one-shot
shell invocation that exercises a specific behavior of the script.

## Setup

Tests run inside a throwaway git repo to avoid touching any real `.toggl`:

```bash
smoke=/tmp/toggl-set-smoke
rm -rf "$smoke" && mkdir -p "$smoke" && cd "$smoke" && git init -q
```

Cleanup after each run:

```bash
cd / && rm -rf /tmp/toggl-set-smoke
```

The active Toggl DB at `~/src/bamboo/tools/src/toggl/toggl.db` is consulted
read-only, so these tests do not require `toggl-sync` and never mutate it.

## Cases

### 1. No args → full project list

```bash
echo "" | toggl-set 2>/dev/null | grep -E '^[[:space:]]+[0-9]+[[:space:]]' | wc -l
```

**Expected:** count equals the number of active projects in the local DB
(31 at time of writing). The empty `read` cancels the prompt cleanly.

### 2. No-match query → stderr fallback + full list

```bash
echo "" | toggl-set zzzzzzzz 2>&1 >/dev/null | head -1
echo "" | toggl-set zzzzzzzz 2>/dev/null | grep -E '^[[:space:]]+[0-9]+[[:space:]]' | wc -l
```

**Expected:** stderr contains `No matches for 'zzzzzzzz'; showing all projects.`
and the rendered table has the full 31 rows.

### 3. Case-insensitive match on client_name

```bash
echo "" | toggl-set BAMBOO 2>/dev/null | grep -E '^[[:space:]]+[0-9]+[[:space:]]'
```

**Expected:** five rows whose `client_name` is `Bamboo` (uppercase query
matches lowercase data). Currently:

```
   1  186133116   Internal                          Bamboo
   2  186046633   Learning                          Bamboo
   3  216557449   PTO                               Bamboo
   4  216328138   Personal                          Bamboo
   5  189469205   Prospecting                       Bamboo
```

### 4. Substring on name → single match → auto-select

```bash
rm -f .toggl
toggl-set reports 2>/dev/null
cat .toggl
```

**Expected:** no prompt is rendered. `.toggl` is written with:

```json
{
  "project_id": 215051643,
  "project_name": "Reports Automation",
  "client_name": "AWT"
}
```

### 5. Substring on name → 1 match → auto-select (Internal/Bamboo)

```bash
rm -f .toggl
toggl-set intern 2>/dev/null
cat .toggl
```

**Expected:** auto-select. `.toggl` written with:

```json
{
  "project_id": 186133116,
  "project_name": "Internal",
  "client_name": "Bamboo"
}
```

### 6. Pre-existing .toggl + single match → overwrite (no prompt)

```bash
cat > .toggl <<'JSON'
{
  "project_id": 216557449,
  "project_name": "PTO",
  "client_name": "Bamboo"
}
JSON
toggl-set reports 2>/dev/null
cat .toggl
```

**Expected:** stdout includes the `Current $repo_root/.toggl:` preamble showing
the PTO/Bamboo JSON above (since `.toggl` pre-exists), no `Select project`
prompt is rendered, and `.toggl` afterwards is:

```json
{
  "project_id": 215051643,
  "project_name": "Reports Automation",
  "client_name": "AWT"
}
```

### 7. id-only query no longer matches (id is excluded from scope)

```bash
echo "" | toggl-set 215051643 2>&1 >/dev/null | head -1
echo "" | toggl-set 215051643 2>/dev/null | grep -E '^[[:space:]]+[0-9]+[[:space:]]' | wc -l
```

**Expected:** stderr `No matches for '215051643'; showing all projects.`
and the rendered table is the full 31 rows. The `id` column is intentionally
not part of the substring scope; only `name` and `client_name` are.

### 8. Subsequence query no longer matches

```bash
echo "" | toggl-set bmb 2>&1 >/dev/null | head -1
echo "" | toggl-set bmb 2>/dev/null | grep -E '^[[:space:]]+[0-9]+[[:space:]]' | wc -l
```

**Expected:** stderr `No matches for 'bmb'; showing all projects.` and the
full 31-row list. Substring search requires contiguous characters, unlike
the earlier fuzzy implementation that would have matched `bmb` against
`Bamboo`.

## Run all cases

```bash
smoke=/tmp/toggl-set-smoke
rm -rf "$smoke" && mkdir -p "$smoke" && cd "$smoke" && git init -q

echo "=== 1. no args -> full list count ==="
echo "" | toggl-set 2>/dev/null | grep -E '^[[:space:]]+[0-9]+[[:space:]]' | wc -l

echo "=== 2. no match -> stderr fallback msg + full list ==="
echo "" | toggl-set zzzzzzzz 2>&1 >/dev/null | head -1
echo "(rows shown:)"
echo "" | toggl-set zzzzzzzz 2>/dev/null | grep -E '^[[:space:]]+[0-9]+[[:space:]]' | wc -l

echo "=== 3. case-insensitive match on client_name ('BAMBOO') ==="
echo "" | toggl-set BAMBOO 2>/dev/null | grep -E '^[[:space:]]+[0-9]+[[:space:]]'

echo "=== 4. substring on name ('reports') -> auto-select ==="
rm -f .toggl
toggl-set reports 2>/dev/null
echo "(.toggl after:)"; cat .toggl 2>/dev/null

echo "=== 5. substring on name ('intern') -> 1 match -> auto-select ==="
rm -f .toggl
toggl-set intern 2>/dev/null
cat .toggl 2>/dev/null

echo "=== 6. pre-existing .toggl + single match -> overwrite ==="
cat > .toggl <<'JSON'
{
  "project_id": 216557449,
  "project_name": "PTO",
  "client_name": "Bamboo"
}
JSON
toggl-set reports 2>/dev/null
echo "(.toggl after:)"; cat .toggl

echo "=== 7. id-only query no longer matches ==="
echo "" | toggl-set 215051643 2>&1 >/dev/null | head -1
echo "(rows shown -> should be full list = 31:)"
echo "" | toggl-set 215051643 2>/dev/null | grep -E '^[[:space:]]+[0-9]+[[:space:]]' | wc -l

echo "=== 8. subsequence ('bmb') no longer matches ==="
echo "" | toggl-set bmb 2>&1 >/dev/null | head -1
echo "(rows shown -> should be full list = 31:)"
echo "" | toggl-set bmb 2>/dev/null | grep -E '^[[:space:]]+[0-9]+[[:space:]]' | wc -l

cd / && rm -rf "$smoke"
```
