// toggl-group.cli.test.ts — bun:test smoke suite for the toggl-group CLI.
// Replaces the manual cases formerly in ../TESTS.md §toggl-group.
//
// The pure-function behavior of the lib (groupEvents, parseHeartbeats,
// heartbeatsFromRows, …) is covered separately by ./toggl-group.test.ts and
// is intentionally not duplicated here. This file exercises the CLI layer:
// input discovery (git toplevel / --repo / --all), exit codes, SQL filters,
// and the JSON output contract.
//
// Run from the repo root:
//   `bun test ./toggl/.local/bin/toggl-group.cli.test.ts`.
//
// Each test allocates a fresh tempdir + state DB via TOGGL_STATE_DB. The
// DB is seeded inline via bun:sqlite from the same fixtures the lib unit
// tests consume (../../test-fixtures/heartbeats-{synthetic,live}.jsonl), so
// the row counts and task names asserted below match the behavior fixtures
// in toggl-group.test.ts ("synthetic fixture: 8 events", "default buffer
// (10 min) → 3 entries", etc.).

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseHeartbeats, type Heartbeat } from "./toggl-group.lib.ts"

const BIN = fileURLToPath(new URL("./toggl-group", import.meta.url))
const FIXTURES_DIR = fileURLToPath(new URL("../../test-fixtures/", import.meta.url))
const SYNTHETIC = join(FIXTURES_DIR, "heartbeats-synthetic.jsonl")
const LIVE = join(FIXTURES_DIR, "heartbeats-live.jsonl")

// uniqueTmpDir — fresh dir under os.tmpdir() returned as a realpath so its
// value matches what `realpath(git_toplevel)` resolves to inside the CLI.
const uniqueTmpDir = (label: string): string => {
  const dir = join(tmpdir(), `${label}-${crypto.randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  return realpathSync(dir)
}

// gitInit — `git init -q` inside `dir`. Bails if git is missing or fails.
const gitInit = (dir: string): void => {
  const res = spawnSync("git", ["init", "-q"], { cwd: dir, encoding: "utf8" })
  if (res.status !== 0) {
    throw new Error(`git init failed in ${dir}: ${res.stderr}`)
  }
}

// initStateDb — create the toggl_heartbeats schema in the given DB path so
// inline seeding has a target to insert into. Mirrors the canonical DDL in
// toggl-state.lib.sh / toggl-time.ts (those are the authoritative copies).
const initStateDb = (dbPath: string): void => {
  const db = new Database(dbPath, { create: true })
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS toggl_heartbeats (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        ts            TEXT    NOT NULL,
        event         TEXT    NOT NULL CHECK (event IN ('start','pause')),
        trigger       TEXT    NOT NULL,
        session_id    TEXT,
        worktree_path TEXT    NOT NULL,
        client_name   TEXT    NOT NULL,
        project_id    INTEGER NOT NULL,
        project_name  TEXT    NOT NULL,
        task          TEXT    NOT NULL,
        details       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_heartbeats_worktree_ts
        ON toggl_heartbeats(worktree_path, ts);
    CREATE INDEX IF NOT EXISTS idx_heartbeats_ts
        ON toggl_heartbeats(ts);
  `)
  db.close?.()
}

// seedHeartbeats — load a JSONL fixture into the given DB keyed under
// `worktreePath`. The TS port of toggl/test-fixtures/seed-heartbeats.sh —
// inlined here so tests don't depend on a bash subprocess for setup.
const seedHeartbeats = (
  dbPath: string,
  worktreePath: string,
  jsonlPath: string,
): void => {
  const { events, warnings } = parseHeartbeats(readFileSync(jsonlPath, "utf8"))
  if (warnings.length > 0) {
    throw new Error(
      `seedHeartbeats: fixture has parse warnings:\n  ${warnings.join("\n  ")}`,
    )
  }
  const db = new Database(dbPath)
  const stmt = db.prepare(`
    INSERT INTO toggl_heartbeats
      (ts, event, trigger, session_id, worktree_path,
       client_name, project_id, project_name, task, details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertAll = db.transaction((rows: Heartbeat[]) => {
    for (const e of rows) {
      stmt.run(
        e.ts,
        e.event,
        e.trigger,
        e.session_id ?? null,
        worktreePath,
        e.client_name,
        e.project_id,
        e.project_name,
        e.task,
        e.details ? JSON.stringify(e.details) : null,
      )
    }
  })
  insertAll(events)
  db.close?.()
}

type CliResult = { stdout: string; stderr: string; status: number }
const runCli = (
  args: string[],
  env: Record<string, string>,
  cwd?: string,
): CliResult => {
  const res = spawnSync(BIN, args, {
    env: { ...process.env, ...env },
    encoding: "utf8",
    cwd,
  })
  if (res.error) throw res.error
  return {
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    status: res.status ?? -1,
  }
}

describe("toggl-group CLI", () => {
  // Per-test isolation: each test gets its own smoke worktree + state DB.
  // The smoke parent dir holds both so cleanup is a single rm -rf.
  let tempRoot: string
  let smoke: string
  let stateDb: string
  let env: Record<string, string>

  beforeEach(() => {
    tempRoot = uniqueTmpDir("toggl-group-cli")
    smoke = join(tempRoot, "smoke")
    stateDb = join(tempRoot, "state.db")
    mkdirSync(smoke, { recursive: true })
    gitInit(smoke)
    initStateDb(stateDb)
    seedHeartbeats(stateDb, smoke, SYNTHETIC)
    env = { TOGGL_STATE_DB: stateDb }
  })

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  // Case 1 — Default (no args) → DB lookup for current worktree.
  test("case 1: default returns 3 entries from synthetic fixture", () => {
    const res = runCli([], env, smoke)
    expect(res.status).toBe(0)
    const entries = JSON.parse(res.stdout)
    expect(entries).toHaveLength(3)
  })

  // Case 2 — `--repo PATH` from outside the worktree.
  test("case 2: --repo PATH bypasses git-toplevel discovery", () => {
    const res = runCli(["--repo", smoke], env, "/")
    expect(res.status).toBe(0)
    const entries = JSON.parse(res.stdout)
    expect(entries).toHaveLength(3)
  })

  // Case 3 — Default vs `--repo` produce identical output.
  test("case 3: default and --repo produce identical output", () => {
    const a = runCli([], env, smoke)
    const b = runCli(["--repo", smoke], env, smoke)
    expect(a.status).toBe(0)
    expect(b.status).toBe(0)
    expect(a.stdout).toBe(b.stdout)
  })

  // Case 4 — `--all` includes other worktrees (live fixture has different
  // tasks/timestamps so groupEvents won't merge them with synthetic).
  test("case 4: --all merges across worktrees", () => {
    const smoke2 = join(tempRoot, "smoke2")
    mkdirSync(smoke2, { recursive: true })
    gitInit(smoke2)
    seedHeartbeats(stateDb, realpathSync(smoke2), LIVE)

    // Default still scoped to the first worktree → 3.
    const def = runCli([], env, smoke)
    expect(def.status).toBe(0)
    expect(JSON.parse(def.stdout)).toHaveLength(3)

    // --all merges both seeds → 7 entries (3 synthetic + 4 live).
    const all = runCli(["--all"], env, smoke)
    expect(all.status).toBe(0)
    const entries = JSON.parse(all.stdout) as Array<{ task: string }>
    expect(entries).toHaveLength(7)
    const tasks = [...new Set(entries.map((e) => e.task))].sort()
    expect(tasks).toEqual([
      "MASTER-1607",
      "MASTER-1608",
      "MASTER-1621",
      "TASK-1",
      "TASK-2",
    ])
  })

  // Case 5 — `--since` / `--until` filter at the SQL level.
  // Synthetic fixture timestamps:
  //   TASK-1 entry 1: 10:00:00, 10:00:05, 10:08:00, 10:08:30
  //   TASK-1 entry 2: 10:20:30, 10:20:45
  //   TASK-2 entry:   11:00:00, 11:00:33
  // The filter applies at the heartbeat-row level (WHERE ts >= ?) BEFORE
  // groupEvents runs, so any heartbeat with ts < `--since` is invisible to
  // the grouper. NB: TESTS.md case 5 incorrectly claimed both TASK-1 entries
  // survived the 10:30 cutoff; in fact the 10:20 entry's events both have
  // ts < 10:30, so they're dropped along with the 10:00–10:08 entry.
  test("case 5: --since / --until filter at SQL level", () => {
    // After the last event → no rows → no entries.
    const after = runCli(["--since", "2026-01-15T12:00:00Z"], env, smoke)
    expect(after.status).toBe(0)
    expect(JSON.parse(after.stdout)).toHaveLength(0)

    // Before the first event → no rows.
    const before = runCli(["--until", "2026-01-15T09:00:00Z"], env, smoke)
    expect(before.status).toBe(0)
    expect(JSON.parse(before.stdout)).toHaveLength(0)

    // 10:30 cutoff: only the 11:00 TASK-2 events survive.
    const partial = runCli(
      ["--since", "2026-01-15T10:30:00Z"],
      env,
      smoke,
    )
    expect(partial.status).toBe(0)
    const tasks = (JSON.parse(partial.stdout) as Array<{ task: string }>).map(
      (e) => e.task,
    )
    expect(tasks).toEqual(["TASK-2"])

    // 10:20 cutoff: keeps the 10:20 TASK-1 entry and the 11:00 TASK-2 entry,
    // drops the 10:00–10:08 entry. This is the assertion TESTS.md probably
    // meant to make.
    const at1020 = runCli(
      ["--since", "2026-01-15T10:20:00Z"],
      env,
      smoke,
    )
    expect(at1020.status).toBe(0)
    const tasks2 = (JSON.parse(at1020.stdout) as Array<{ task: string }>).map(
      (e) => e.task,
    )
    expect(tasks2).toEqual(["TASK-1", "TASK-2"])
  })

  // Case 6 — State DB missing → exit 1.
  test("case 6: state DB missing exits 1 with diagnostic", () => {
    const missing = join(tempRoot, "absent.db")
    const res = runCli([], { TOGGL_STATE_DB: missing }, smoke)
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(
      new RegExp(`toggl-group: state DB not found at ${missing}`),
    )
  })

  // Case 7 — Worktree with no rows → empty array, exit 0.
  test("case 7: worktree with no rows returns []", () => {
    const empty = join(tempRoot, "empty")
    mkdirSync(empty, { recursive: true })
    gitInit(empty)
    const res = runCli([], env, empty)
    expect(res.status).toBe(0)
    expect(res.stdout.trim()).toBe("[]")
  })

  // Case 8 — Outside any git repo, no --repo/--all → exit 1.
  test("case 8: outside any git repo exits 1 with hint", () => {
    const nonGit = join(tempRoot, "non-git")
    mkdirSync(nonGit, { recursive: true })
    const res = runCli([], env, nonGit)
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(
      /toggl-group: not in a git repo \(try --repo PATH or --all\)/,
    )
  })

  // Case 9 — Unknown flag → exit 1.
  test("case 9: unknown flag exits 1", () => {
    const res = runCli(["--bogus"], env, smoke)
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/toggl-group: unknown argument: --bogus/)
  })

  // Case 10 — Invalid `--since` value → exit 1.
  test("case 10: invalid --since exits 1 with parse error", () => {
    const res = runCli(["--since", "not-a-date"], env, smoke)
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(
      /toggl-group: --since value not parseable as a date: not-a-date/,
    )
  })

  // Case 11 — `--all` and `--repo` together → exit 1.
  test("case 11: --all and --repo together exits 1", () => {
    const res = runCli(["--all", "--repo", "/tmp"], env, smoke)
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(
      /toggl-group: --all and --repo are mutually exclusive/,
    )
  })
})
