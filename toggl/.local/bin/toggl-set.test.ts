// toggl-set.test.ts — bun:test smoke suite for the toggl-set CLI. Replaces
// the manual cases formerly in ../TESTS.md §toggl-set.
//
// Run from the repo root: `bun test ./toggl/.local/bin/toggl-set.test.ts`.
//
// Hermeticity:
//   - TOGGL_STATE_DB → per-test temp file, so we never write the user's
//     real ~/.local/state/toggl/state.db.
//   - TOGGL_PROJECT_DB → an in-memory-seeded fixture with exactly 31 active
//     projects, including the 6 projects TESTS.md asserted against by id
//     (Internal/186133116, Learning/186046633, PTO/216557449,
//     Personal/216328138, Prospecting/189469205 under client "Bamboo";
//     Reports Automation/215051643 under client "AWT") plus 25 deterministic
//     filler rows. Filler names/clients are chosen so they cannot match the
//     query strings the tests use ("BAMBOO", "reports", "intern", "bmb").
//
// stdin piping:
//   - read -p "..." in bash only emits the prompt when stdin is a TTY; under
//     pipe stdin, the read still consumes one line silently. Tests pipe an
//     empty line to either cancel project selection (cases 1-3, 9-10) or
//     accept the empty default for the task prompt (cases 4-8, 12-13).
//
// Worktree key:
//   - toggl-set keys state by `realpath(git rev-parse --show-toplevel)`, so
//     each test runs the binary inside a freshly git-init'd tempdir and
//     compares against that realpath.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { spawnSync } from "node:child_process"
import { mkdirSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const BIN = fileURLToPath(new URL("./toggl-set", import.meta.url))

const uniqueTmpDir = (label: string): string => {
  const dir = join(tmpdir(), `${label}-${crypto.randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  return realpathSync(dir)
}

const gitInit = (dir: string): void => {
  const res = spawnSync("git", ["init", "-q"], { cwd: dir, encoding: "utf8" })
  if (res.status !== 0) {
    throw new Error(`git init failed in ${dir}: ${res.stderr}`)
  }
}

// initStateDb — only the toggl_repo_state schema; toggl-set's library calls
// toggl_state_init which would create both tables, but the binary only ever
// reads/writes toggl_repo_state, so a slim init is fine for tests.
const initStateDb = (dbPath: string): void => {
  const db = new Database(dbPath, { create: true })
  db.exec(`
    CREATE TABLE IF NOT EXISTS toggl_repo_state (
        worktree_path TEXT PRIMARY KEY,
        project_id    INTEGER NOT NULL,
        project_name  TEXT    NOT NULL,
        client_name   TEXT,
        task          TEXT,
        updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `)
  db.close?.()
}

// setStateRow — replicates the `set_state()` helper from TESTS.md. Pass null
// to clear the row for `worktreePath`; otherwise INSERT OR REPLACE.
const setStateRow = (
  dbPath: string,
  worktreePath: string,
  row: {
    project_id: number
    project_name: string
    client_name: string | null
    task: string | null
  } | null,
): void => {
  const db = new Database(dbPath)
  db.prepare(
    `DELETE FROM toggl_repo_state WHERE worktree_path = ?`,
  ).run(worktreePath)
  if (row) {
    db.prepare(
      `INSERT INTO toggl_repo_state
         (worktree_path, project_id, project_name, client_name, task)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      worktreePath,
      row.project_id,
      row.project_name,
      row.client_name,
      row.task,
    )
  }
  db.close?.()
}

// dumpStateRow — replicates the `dump_state()` helper from TESTS.md. Returns
// undefined when no row exists, matching the empty-string semantics of the
// shell version (TESTS.md normalized NULL → '<null>'; here we just expose
// the raw row to make assertions explicit).
const dumpStateRow = (
  dbPath: string,
  worktreePath: string,
):
  | {
      project_id: number
      project_name: string
      client_name: string | null
      task: string | null
    }
  | undefined => {
  const db = new Database(dbPath, { readonly: true })
  const row = db
    .query<
      {
        project_id: number
        project_name: string
        client_name: string | null
        task: string | null
      },
      [string]
    >(
      `SELECT project_id, project_name, client_name, task
       FROM toggl_repo_state
       WHERE worktree_path = ?`,
    )
    .get(worktreePath)
  db.close?.()
  return row ?? undefined
}

// initProjectDb — seed the fixture project DB with exactly 31 active rows.
// Schema mirrors the live ~/src/bamboo/tools/src/toggl/toggl.db; only the
// columns toggl-set's SQL touches need real values, but we set the NOT NULL
// columns explicitly so an inadvertent schema-tightening upstream surfaces
// here rather than in production.
const initProjectDb = (dbPath: string): void => {
  const db = new Database(dbPath, { create: true })
  db.exec(`
    CREATE TABLE toggl_projects (
        id                  INTEGER PRIMARY KEY,
        workspace_id        INTEGER NOT NULL,
        client_id           INTEGER NOT NULL,
        name                TEXT NOT NULL,
        client_name         TEXT,
        active              BOOLEAN NOT NULL DEFAULT 1,
        is_private          BOOLEAN NOT NULL DEFAULT 0,
        recurring           BOOLEAN NOT NULL DEFAULT 0,
        billable            BOOLEAN,
        created_at          TEXT NOT NULL,
        at                  TEXT NOT NULL,
        actual_seconds      INTEGER,
        estimated_seconds   INTEGER,
        fixed_fee           INTEGER,
        rate                REAL,
        rate_last_updated   TEXT,
        currency            TEXT,
        start_date          TEXT,
        end_date            TEXT,
        period_start_date   TEXT,
        period_end_date     TEXT,
        status_state        TEXT,
        status_description  TEXT
    );
  `)

  // Sentinel ts so all rows have a stable created_at / at value.
  const TS = "2026-01-01T00:00:00.000Z"
  const insert = db.prepare(`
    INSERT INTO toggl_projects
      (id, workspace_id, client_id, name, client_name, active, created_at, at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `)

  // The 6 named projects TESTS.md asserts against by id.
  const named: Array<[number, number, string, string]> = [
    [186133116, 1, "Internal", "Bamboo"],
    [186046633, 1, "Learning", "Bamboo"],
    [216557449, 1, "PTO", "Bamboo"],
    [216328138, 1, "Personal", "Bamboo"],
    [189469205, 1, "Prospecting", "Bamboo"],
    [215051643, 2, "Reports Automation", "AWT"],
  ]
  for (const [id, clientId, name, client] of named) {
    insert.run(id, 100, clientId, name, client, TS, TS)
  }

  // 25 filler rows under 5 throwaway clients. Names + client names are
  // deliberately chosen so none contain "bamboo", "reports", "intern", or
  // "bmb" (case-insensitive substring match against name OR client_name —
  // see toggl-set:75-87) and none contain the digit string "215051643".
  const fillerClients: Array<[number, string]> = [
    [3, "ClientA"],
    [4, "ClientB"],
    [5, "ClientC"],
    [6, "ClientD"],
    [7, "ClientE"],
  ]
  let nextId = 300_000_000
  for (const [clientId, clientName] of fillerClients) {
    for (let i = 1; i <= 5; i++) {
      const projName = `Project${String(nextId - 300_000_000 + 1).padStart(2, "0")}`
      insert.run(nextId, 100, clientId, projName, clientName, TS, TS)
      nextId++
    }
  }
  db.close?.()
}

type CliResult = { stdout: string; stderr: string; status: number }
const runCli = (
  args: string[],
  env: Record<string, string>,
  cwd: string,
  stdin = "",
): CliResult => {
  const res = spawnSync(BIN, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    input: stdin,
  })
  if (res.error) throw res.error
  return {
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    status: res.status ?? -1,
  }
}

// countTableRows — number of rendered project rows in stdout. The script
// emits each row with `printf '%4d  %-10s  ...'` so every row begins with
// 1+ spaces, an integer, and a space. The header (`idx`) and divider
// (`---`) lines don't match.
const countTableRows = (out: string): number => {
  let n = 0
  for (const line of out.split("\n")) {
    if (/^\s+\d+\s/.test(line)) n++
  }
  return n
}

// rowAtIndex — return the rendered line for the given 1-based table index.
const rowAtIndex = (out: string, idx: number): string | undefined => {
  const re = new RegExp(`^\\s+${idx}\\s`)
  for (const line of out.split("\n")) {
    if (re.test(line)) return line
  }
  return undefined
}

describe("toggl-set", () => {
  let tempRoot: string
  let smoke: string
  let stateDb: string
  let projectDb: string
  let env: Record<string, string>

  beforeEach(() => {
    tempRoot = uniqueTmpDir("toggl-set-test")
    smoke = join(tempRoot, "smoke")
    mkdirSync(smoke, { recursive: true })
    gitInit(smoke)
    smoke = realpathSync(smoke)

    stateDb = join(tempRoot, "state.db")
    projectDb = join(tempRoot, "projects.db")
    initStateDb(stateDb)
    initProjectDb(projectDb)

    env = {
      TOGGL_STATE_DB: stateDb,
      TOGGL_PROJECT_DB: projectDb,
    }
  })

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  // Case 1 — No args → full project list (31 rows).
  test("case 1: no args renders the full 31-row project list", () => {
    const res = runCli([], env, smoke, "\n")
    expect(res.status).toBe(0)
    expect(countTableRows(res.stdout)).toBe(31)
  })

  // Case 2 — No-match query → stderr fallback + full list.
  test("case 2: no-match query falls back to full list with stderr notice", () => {
    const res = runCli(["zzzzzzzz"], env, smoke, "\n")
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/No matches for 'zzzzzzzz'; showing all projects\./)
    expect(countTableRows(res.stdout)).toBe(31)
  })

  // Case 3 — Case-insensitive client_name match returns 5 Bamboo rows in
  // alphabetical name order.
  test("case 3: case-insensitive BAMBOO query returns 5 Bamboo rows", () => {
    const res = runCli(["BAMBOO"], env, smoke, "\n")
    expect(res.status).toBe(0)
    expect(countTableRows(res.stdout)).toBe(5)
    // Names sorted alphabetically (Internal, Learning, PTO, Personal, Prospecting).
    // Note "PTO" < "Personal" because uppercase letters precede lowercase
    // in default ASCII ordering, and SQLite's `ORDER BY name` is byte-wise
    // unless COLLATE NOCASE is applied (it's not here).
    expect(rowAtIndex(res.stdout, 1)).toContain("Internal")
    expect(rowAtIndex(res.stdout, 2)).toContain("Learning")
    expect(rowAtIndex(res.stdout, 3)).toContain("PTO")
    expect(rowAtIndex(res.stdout, 4)).toContain("Personal")
    expect(rowAtIndex(res.stdout, 5)).toContain("Prospecting")
  })

  // Case 4 — Substring match → single match → auto-select with empty task.
  test("case 4: 'reports' auto-selects Reports Automation, empty task → NULL", () => {
    setStateRow(stateDb, smoke, null)
    const res = runCli(["reports"], env, smoke, "\n")
    expect(res.status).toBe(0)
    expect(dumpStateRow(stateDb, smoke)).toEqual({
      project_id: 215051643,
      project_name: "Reports Automation",
      client_name: "AWT",
      task: null,
    })
  })

  // Case 5 — Substring match on a name → 1 match → auto-select Internal/Bamboo.
  test("case 5: 'intern' auto-selects Internal/Bamboo, empty task → NULL", () => {
    setStateRow(stateDb, smoke, null)
    const res = runCli(["intern"], env, smoke, "\n")
    expect(res.status).toBe(0)
    expect(dumpStateRow(stateDb, smoke)).toEqual({
      project_id: 186133116,
      project_name: "Internal",
      client_name: "Bamboo",
      task: null,
    })
  })

  // Case 6 — Pre-existing row + single match → overwrite with no project prompt.
  test("case 6: pre-existing row + single match overwrites", () => {
    setStateRow(stateDb, smoke, {
      project_id: 216557449,
      project_name: "PTO",
      client_name: "Bamboo",
      task: null,
    })
    const res = runCli(["reports"], env, smoke, "\n")
    expect(res.status).toBe(0)
    // Preamble lists the existing row before the auto-select fires.
    expect(res.stdout).toMatch(new RegExp(`^Current project \\(${smoke}\\):`))
    expect(res.stdout).toContain('"project_id": 216557449')
    expect(res.stdout).toContain('"project_name": "PTO"')
    // Single-match auto-select means no Select-project prompt is rendered.
    expect(res.stdout).not.toMatch(/Select project /)
    // Final row reflects the auto-selected Reports Automation.
    expect(dumpStateRow(stateDb, smoke)).toEqual({
      project_id: 215051643,
      project_name: "Reports Automation",
      client_name: "AWT",
      task: null,
    })
  })

  // Case 7 — Multi-match including the current row → green ANSI on row 1.
  test("case 7: multi-match including current → green at row 1", () => {
    setStateRow(stateDb, smoke, {
      project_id: 216328138,
      project_name: "Personal",
      client_name: "Bamboo",
      task: null,
    })
    // Row count: 5 (Personal already in result; no synthesis).
    const plain = runCli(["bamboo"], env, smoke, "\n")
    expect(plain.status).toBe(0)
    expect(countTableRows(plain.stdout)).toBe(5)
    const r1 = rowAtIndex(plain.stdout, 1)
    expect(r1).toContain("216328138")
    expect(r1).toContain("Personal")

    // No ANSI codes when output is piped (TTY check off).
    expect(plain.stdout).not.toMatch(/\u001b\[/)

    // With FORCE_COLOR=1, row 1 carries the green escape.
    const colored = runCli(
      ["bamboo"],
      { ...env, FORCE_COLOR: "1" },
      smoke,
      "\n",
    )
    const c1 = rowAtIndex(colored.stdout, 1) ?? ""
    expect(c1).toContain("\u001b[32m")
    expect(c1).not.toContain("\u001b[31m")
  })

  // Case 8 — Multi-match excluding the current row → red ANSI on row 1, current
  // row synthesized as a 6th entry.
  test("case 8: multi-match excluding current → red at row 1, synthesized", () => {
    setStateRow(stateDb, smoke, {
      project_id: 215051643,
      project_name: "Reports Automation",
      client_name: "AWT",
      task: null,
    })
    // Row count: 6 (5 Bamboo matches + Reports Automation prepended).
    const plain = runCli(["bamboo"], env, smoke, "\n")
    expect(plain.status).toBe(0)
    expect(countTableRows(plain.stdout)).toBe(6)
    const r1 = rowAtIndex(plain.stdout, 1)
    expect(r1).toContain("215051643")
    expect(r1).toContain("Reports Automation")

    // Red ANSI on row 1 when FORCE_COLOR=1.
    const colored = runCli(
      ["bamboo"],
      { ...env, FORCE_COLOR: "1" },
      smoke,
      "\n",
    )
    const c1 = rowAtIndex(colored.stdout, 1) ?? ""
    expect(c1).toContain("\u001b[31m")
    expect(c1).not.toContain("\u001b[32m")
  })

  // Case 9 — id-only query no longer matches; fallback to full list.
  test("case 9: id-only query does not match (id excluded from scope)", () => {
    const res = runCli(["215051643"], env, smoke, "\n")
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/No matches for '215051643'; showing all projects\./)
    expect(countTableRows(res.stdout)).toBe(31)
  })

  // Case 10 — Subsequence query no longer matches (substring is contiguous).
  test("case 10: subsequence 'bmb' does not match; falls back to full list", () => {
    const res = runCli(["bmb"], env, smoke, "\n")
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/No matches for 'bmb'; showing all projects\./)
    expect(countTableRows(res.stdout)).toBe(31)
  })

  // Case 11 — Auto-select prompts for task; non-empty input is stored.
  test("case 11: auto-select stores non-empty task input", () => {
    setStateRow(stateDb, smoke, null)
    const res = runCli(["reports"], env, smoke, "Run smoke tests\n")
    expect(res.status).toBe(0)
    expect(dumpStateRow(stateDb, smoke)).toEqual({
      project_id: 215051643,
      project_name: "Reports Automation",
      client_name: "AWT",
      task: "Run smoke tests",
    })
  })

  // Case 12 — Re-select same project + empty input → bracket-default keeps task.
  test("case 12: re-select same project + empty input preserves task", () => {
    setStateRow(stateDb, smoke, {
      project_id: 215051643,
      project_name: "Reports Automation",
      client_name: "AWT",
      task: "Existing task description",
    })
    const res = runCli(["reports"], env, smoke, "\n")
    expect(res.status).toBe(0)
    expect(dumpStateRow(stateDb, smoke)).toEqual({
      project_id: 215051643,
      project_name: "Reports Automation",
      client_name: "AWT",
      task: "Existing task description",
    })
  })

  // Case 13 — Switch projects + empty input → task cleared to NULL.
  test("case 13: switch projects + empty input clears task to NULL", () => {
    setStateRow(stateDb, smoke, {
      project_id: 215051643,
      project_name: "Reports Automation",
      client_name: "AWT",
      task: "Existing task description",
    })
    const res = runCli(["intern"], env, smoke, "\n")
    expect(res.status).toBe(0)
    expect(dumpStateRow(stateDb, smoke)).toEqual({
      project_id: 186133116,
      project_name: "Internal",
      client_name: "Bamboo",
      task: null,
    })
  })
})
