// toggl_project.test.ts — bun:test smoke suite for the tmux status-segment
// helper at ./toggl_project.sh. Replaces the manual cases formerly in
// ../../../toggl/TESTS.md §tmux toggl_project.sh.
//
// The script is a tiny bash wrapper that resolves CWD → worktree row in the
// central state DB (~/.local/state/toggl/state.db by default) and emits a
// tmux-markup-decorated segment, falling back to "NO PROJECT" when no row
// matches. This file exercises the lookup strategy (git-toplevel exact
// match, longest-prefix walk fallback, prefix-collision guard) and the
// no-DB fast path.
//
// The script honors TOGGL_STATE_DB (added in this same change), so each
// test points at an isolated DB without touching the user's real one.
//
// Run from the repo root:
//   `bun test ./tmux/.config/tmux/toggl_project.test.ts`.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { spawnSync } from "node:child_process"
import { mkdirSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT = fileURLToPath(new URL("./toggl_project.sh", import.meta.url))

const uniqueTmpDir = (label: string): string => {
  const dir = join(tmpdir(), `${label}-${crypto.randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  return realpathSync(dir)
}

// initStateDb — create just the toggl_repo_state schema (the script doesn't
// touch toggl_heartbeats). Mirrors the canonical DDL in toggl-state.lib.sh.
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

const seedRepoState = (
  dbPath: string,
  row: {
    worktree_path: string
    project_id: number
    project_name: string
    client_name: string | null
    task: string | null
  },
): void => {
  const db = new Database(dbPath)
  db.prepare(
    `INSERT OR REPLACE INTO toggl_repo_state
       (worktree_path, project_id, project_name, client_name, task)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    row.worktree_path,
    row.project_id,
    row.project_name,
    row.client_name,
    row.task,
  )
  db.close?.()
}

const gitInit = (dir: string): void => {
  const res = spawnSync("git", ["init", "-q"], { cwd: dir, encoding: "utf8" })
  if (res.status !== 0) {
    throw new Error(`git init failed in ${dir}: ${res.stderr}`)
  }
}

type CliResult = { stdout: string; stderr: string; status: number }
const runScript = (cwd: string, env: Record<string, string>): CliResult => {
  const res = spawnSync(SCRIPT, [], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  })
  if (res.error) throw res.error
  return {
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    status: res.status ?? -1,
  }
}

describe("tmux toggl_project.sh", () => {
  let tempRoot: string
  let smoke: string // non-git registered ancestor (walk fallback target)
  let gitSmoke: string // git-init'd registered worktree (git-toplevel match)
  let stateDb: string
  let env: Record<string, string>

  beforeEach(() => {
    tempRoot = uniqueTmpDir("tmux-toggl-test")
    smoke = join(tempRoot, "smoke")
    gitSmoke = join(tempRoot, "git-smoke")
    mkdirSync(join(smoke, "sub/deep"), { recursive: true })
    mkdirSync(gitSmoke, { recursive: true })
    gitInit(gitSmoke)
    smoke = realpathSync(smoke)
    gitSmoke = realpathSync(gitSmoke)

    stateDb = join(tempRoot, "state.db")
    initStateDb(stateDb)
    seedRepoState(stateDb, {
      worktree_path: smoke,
      project_id: 999,
      project_name: "WalkRepo",
      client_name: "WalkClient",
      task: "WalkTask",
    })
    seedRepoState(stateDb, {
      worktree_path: gitSmoke,
      project_id: 888,
      project_name: "GitRepo",
      client_name: "GitClient",
      task: "GitTask",
    })

    env = { TOGGL_STATE_DB: stateDb }
  })

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  // The full segment the script emits when all four fields are populated.
  // Hard-coded so a regression in the markup format also gets caught.
  const expectedGitSegment =
    "client: #[fg=blue,bold]GitClient#[fg=brightblack,nobold] | " +
    "proj: #[fg=blue,bold]GitRepo#[fg=brightblack,nobold] (888) | " +
    "task: #[fg=blue,bold]GitTask#[fg=brightblack,nobold]\n"

  // Case 1 — Inside a registered git worktree → git-toplevel match.
  test("case 1: inside registered git worktree emits git-toplevel match", () => {
    const res = runScript(gitSmoke, env)
    expect(res.status).toBe(0)
    expect(res.stdout).toBe(expectedGitSegment)
  })

  // Case 2 — Deep subdir of a registered git worktree → still git-toplevel match.
  test("case 2: deep subdir of git worktree resolves to the toplevel", () => {
    const deep = join(gitSmoke, "a/b/c")
    mkdirSync(deep, { recursive: true })
    const res = runScript(deep, env)
    expect(res.status).toBe(0)
    expect(res.stdout).toBe(expectedGitSegment)
  })

  // Case 3 — Non-git subdir of a registered (non-git) ancestor → walk fallback.
  test("case 3: non-git subdir uses longest-prefix ancestor", () => {
    const res = runScript(join(smoke, "sub/deep"), env)
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("proj: #[fg=blue,bold]WalkRepo")
    expect(res.stdout).toContain("(999)")
    expect(res.stdout).toContain("client: #[fg=blue,bold]WalkClient")
    expect(res.stdout).toContain("task: #[fg=blue,bold]WalkTask")
  })

  // Case 4 — Prefix-collision guard. /tmp/foo registered should NOT match
  // /tmp/foobar — the `worktree_path || '/%'` clause forces a path-component
  // boundary.
  test("case 4: sibling with shared prefix does not match", () => {
    // Create /tmp/<uuid>/smokey alongside the registered /tmp/<uuid>/smoke.
    const smokey = `${smoke}y`
    mkdirSync(smokey, { recursive: true })
    const res = runScript(smokey, env)
    expect(res.status).toBe(0)
    expect(res.stdout.trim()).toBe("NO PROJECT")
  })

  // Case 5 — Outside any registered tree → NO PROJECT. Run from a fresh
  // tempdir whose path is not registered (and is not under any git toplevel
  // that's registered).
  test("case 5: outside any registered tree returns NO PROJECT", () => {
    const orphan = uniqueTmpDir("tmux-toggl-orphan")
    try {
      const res = runScript(orphan, env)
      expect(res.status).toBe(0)
      expect(res.stdout.trim()).toBe("NO PROJECT")
    } finally {
      rmSync(orphan, { recursive: true, force: true })
    }
  })

  // Case 6 — State DB missing → NO PROJECT, exit 0 (fresh-machine path).
  test("case 6: missing state DB falls through to NO PROJECT", () => {
    const res = runScript(smoke, {
      TOGGL_STATE_DB: join(tempRoot, "absent.db"),
    })
    expect(res.status).toBe(0)
    expect(res.stdout.trim()).toBe("NO PROJECT")
    // No diagnostics on stderr — the missing DB is a graceful no-op, not an
    // error condition.
    expect(res.stderr).toBe("")
  })
})
