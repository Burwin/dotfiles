// toggl-time-migrate.test.ts — bun:test smoke suite for the toggl-time-migrate
// CLI. Replaces the manual cases formerly in ../TESTS.md §toggl-time-migrate.
//
// Run from the repo root: `bun test toggl/.local/bin/toggl-time-migrate.test.ts`.
//
// Each test allocates an isolated tempdir + state DB via TOGGL_STATE_DB so it
// never touches the user's real ~/.local/state/toggl/state.db. Fixtures are
// copied from ../../test-fixtures/heartbeats-synthetic.jsonl, the same fixture
// the lib unit tests in ./toggl-group.test.ts consume.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

// Resolve the binary under test and the fixtures dir relative to this file's
// location so the suite is portable across checkouts.
const BIN = fileURLToPath(new URL("./toggl-time-migrate", import.meta.url))
const FIXTURES_DIR = fileURLToPath(new URL("../../test-fixtures/", import.meta.url))
const SYNTHETIC = join(FIXTURES_DIR, "heartbeats-synthetic.jsonl")

// uniqueTmpDir — `os.tmpdir()` + a randomUUID slug. Returns the realpath so
// tests can compare against the worktree_path the migrator stores (which goes
// through `realpath`).
const uniqueTmpDir = (label: string): string => {
  const dir = join(tmpdir(), `${label}-${crypto.randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  return realpathSync(dir)
}

// runCli — spawn toggl-time-migrate synchronously with the given args + env,
// surface the captured streams + exit code in a stable shape for assertions.
type CliResult = { stdout: string; stderr: string; status: number }
const runCli = (
  args: string[],
  env: Record<string, string>,
): CliResult => {
  const res = spawnSync(BIN, args, {
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

describe("toggl-time-migrate", () => {
  let smoke: string
  let stateDb: string
  let env: Record<string, string>

  beforeEach(() => {
    smoke = uniqueTmpDir("toggl-time-migrate-smoke")
    stateDb = join(smoke, "state.db")
    env = { TOGGL_STATE_DB: stateDb }
  })

  afterEach(() => {
    rmSync(smoke, { recursive: true, force: true })
  })

  // seedRepos — stage the four repo flavors that TESTS.md exercises:
  //   repo-a / repo-b: full synthetic fixture (8 rows each, all valid)
  //   repo-empty:     empty file (0 rows)
  //   repo-mixed:     "not json\n" + synthetic fixture (1 bad line, 8 valid)
  // Returns the realpath'd worktree dirs so callers can assert against the
  // exact key the migrator stores.
  const seedRepos = (): {
    a: string
    b: string
    empty: string
    mixed: string
  } => {
    const repos = ["repo-a", "repo-b", "repo-empty", "repo-mixed"]
    for (const r of repos) mkdirSync(join(smoke, r), { recursive: true })
    copyFileSync(SYNTHETIC, join(smoke, "repo-a/.toggl-time"))
    copyFileSync(SYNTHETIC, join(smoke, "repo-b/.toggl-time"))
    writeFileSync(join(smoke, "repo-empty/.toggl-time"), "")
    const synthetic = require("node:fs").readFileSync(SYNTHETIC, "utf8")
    writeFileSync(
      join(smoke, "repo-mixed/.toggl-time"),
      `not json\n${synthetic}`,
    )
    // realpath each repo to match what the migrator stores. `smoke` is already
    // the realpath of its parent so direct join is safe.
    return {
      a: realpathSync(join(smoke, "repo-a")),
      b: realpathSync(join(smoke, "repo-b")),
      empty: realpathSync(join(smoke, "repo-empty")),
      mixed: realpathSync(join(smoke, "repo-mixed")),
    }
  }

  // Case 1 — `--dry-run` lists imports, doesn't touch the DB.
  test("case 1: --dry-run summarizes without creating the DB", () => {
    seedRepos()
    const res = runCli(["--root", smoke, "--dry-run"], env)
    expect(res.status).toBe(0)
    // stderr flags repo-mixed line 1 as invalid JSON.
    expect(res.stderr).toMatch(/repo-mixed\/\.toggl-time: line 1: invalid JSON/)
    // stdout has one `import …` line per repo.
    expect(res.stdout).toMatch(/import .*repo-a\/\.toggl-time\n  path=.*repo-a rows=8 skipped=0/)
    expect(res.stdout).toMatch(/import .*repo-b\/\.toggl-time\n  path=.*repo-b rows=8 skipped=0/)
    expect(res.stdout).toMatch(/import .*repo-empty\/\.toggl-time\n  path=.*repo-empty rows=0 skipped=0/)
    expect(res.stdout).toMatch(/import .*repo-mixed\/\.toggl-time\n  path=.*repo-mixed rows=8 skipped=1/)
    // Final summary in dry-run shape.
    expect(res.stdout).toMatch(
      /summary \(dry-run\): imported_rows=24 skipped_rows=1 files_deleted=0/,
    )
    // The DB file must NOT exist after a dry-run (TESTS.md case 1 asserts this
    // via `ls -la "$TOGGL_STATE_DB"` returning "No such file or directory").
    expect(() => statSync(stateDb)).toThrow()
  })

  // Case 2 — Real run with `--delete` writes rows, removes only successful sources.
  test("case 2: --delete writes rows + removes only successful sources", () => {
    const repos = seedRepos()
    const res = runCli(["--root", smoke, "--delete"], env)
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(
      /summary: imported_rows=24 skipped_rows=1 files_deleted=3/,
    )

    // Rows landed in the DB grouped by worktree_path.
    const db = new Database(stateDb, { readonly: true })
    const rows = db
      .query<
        { worktree_path: string; n: number },
        []
      >(
        "SELECT worktree_path, COUNT(*) as n FROM toggl_heartbeats GROUP BY worktree_path ORDER BY worktree_path;",
      )
      .all()
    db.close?.()
    const counts = new Map(rows.map((r) => [r.worktree_path, r.n]))
    expect(counts.size).toBe(3)
    expect(counts.get(repos.a)).toBe(8)
    expect(counts.get(repos.b)).toBe(8)
    expect(counts.get(repos.mixed)).toBe(8)
    // repo-empty contributed zero rows so it doesn't appear in GROUP BY.
    expect(counts.get(repos.empty)).toBeUndefined()

    // .toggl-time files: a/b/empty deleted, mixed retained for re-attempt.
    expect(() => statSync(join(smoke, "repo-a/.toggl-time"))).toThrow()
    expect(() => statSync(join(smoke, "repo-b/.toggl-time"))).toThrow()
    expect(() => statSync(join(smoke, "repo-empty/.toggl-time"))).toThrow()
    expect(statSync(join(smoke, "repo-mixed/.toggl-time")).isFile()).toBe(true)
  })

  // Case 3 — Missing root → warning, exit 0.
  test("case 3: missing root logs warning and exits 0", () => {
    const res = runCli(["--root", "/no/such/root", "--dry-run"], env)
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(
      /toggl-time-migrate: root \/no\/such\/root not found, skipping/,
    )
    expect(res.stdout).toMatch(
      /summary \(dry-run\): imported_rows=0 skipped_rows=0 files_deleted=0/,
    )
  })

  // Case 4 — Unknown flag → exit 1.
  test("case 4: unknown flag exits 1 with usage error", () => {
    const res = runCli(["--bogus"], env)
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/toggl-time-migrate: unknown argument: --bogus/)
  })
})
