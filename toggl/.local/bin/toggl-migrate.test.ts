// toggl-migrate.test.ts — bun:test smoke suite for the toggl-migrate CLI.
// Replaces the manual cases formerly in ../TESTS.md §toggl-migrate.
//
// Run from the repo root: `bun test ./toggl/.local/bin/toggl-migrate.test.ts`.
//
// Each test allocates an isolated tempdir + state DB via TOGGL_STATE_DB so
// it never touches the user's real ~/.local/state/toggl/state.db.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { spawnSync } from "node:child_process"
import { mkdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const BIN = fileURLToPath(new URL("./toggl-migrate", import.meta.url))

// uniqueTmpDir — returns the realpath of a fresh dir under os.tmpdir() so
// tests can compare against the worktree_path the migrator stores (which
// goes through `realpath`).
const uniqueTmpDir = (label: string): string => {
  const dir = join(tmpdir(), `${label}-${crypto.randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  return realpathSync(dir)
}

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

describe("toggl-migrate", () => {
  let smoke: string
  let stateDb: string
  let env: Record<string, string>

  beforeEach(() => {
    smoke = uniqueTmpDir("toggl-migrate-smoke")
    stateDb = join(smoke, "state.db")
    env = { TOGGL_STATE_DB: stateDb }
  })

  afterEach(() => {
    rmSync(smoke, { recursive: true, force: true })
  })

  // seedRepos — stage the four `.toggl` shapes from TESTS.md:
  //   repo-a:      fully populated valid JSON (project_id 111)
  //   repo-b:      valid JSON with NULL client_name and task (project_id 222)
  //   bad-json:    not JSON at all
  //   missing-id:  valid JSON missing project_id
  const seedRepos = (): {
    a: string
    b: string
    badJson: string
    missingId: string
  } => {
    const dirs = ["repo-a", "repo-b", "bad-json", "missing-id"]
    for (const d of dirs) mkdirSync(join(smoke, d), { recursive: true })
    writeFileSync(
      join(smoke, "repo-a/.toggl"),
      JSON.stringify({
        project_id: 111,
        project_name: "Alpha",
        client_name: "Acme",
        task: "T-1",
      }) + "\n",
    )
    writeFileSync(
      join(smoke, "repo-b/.toggl"),
      JSON.stringify({
        project_id: 222,
        project_name: "Beta",
        client_name: null,
        task: null,
      }) + "\n",
    )
    writeFileSync(join(smoke, "bad-json/.toggl"), "this is not json\n")
    writeFileSync(
      join(smoke, "missing-id/.toggl"),
      JSON.stringify({ project_name: "NoID" }) + "\n",
    )
    return {
      a: realpathSync(join(smoke, "repo-a")),
      b: realpathSync(join(smoke, "repo-b")),
      badJson: realpathSync(join(smoke, "bad-json")),
      missingId: realpathSync(join(smoke, "missing-id")),
    }
  }

  // Case 1 — `--dry-run` lists imports, doesn't touch the DB.
  test("case 1: --dry-run summarizes without creating the DB", () => {
    seedRepos()
    const res = runCli(["--root", smoke, "--dry-run"], env)
    expect(res.status).toBe(0)
    // stderr flags both unsuccessful files.
    expect(res.stderr).toMatch(/bad-json\/\.toggl: invalid JSON, skipping/)
    expect(res.stderr).toMatch(
      /missing-id\/\.toggl: missing or non-numeric project_id, skipping/,
    )
    // stdout has `import …` lines for the two valid sources.
    expect(res.stdout).toMatch(
      /import .*repo-a\/\.toggl\n  path=.*repo-a id=111 name=Alpha client=Acme task=T-1/,
    )
    expect(res.stdout).toMatch(
      /import .*repo-b\/\.toggl\n  path=.*repo-b id=222 name=Beta client=<null> task=<null>/,
    )
    // Final summary in dry-run shape.
    expect(res.stdout).toMatch(
      /summary \(dry-run\): imported=2 skipped=2 deleted=0/,
    )
    // DB file does NOT exist after a dry-run.
    expect(() => statSync(stateDb)).toThrow()
  })

  // Case 2 — Real run with `--delete` writes rows + removes only successful
  // sources. Asserts DB content shape (NULLs preserved) and on-disk presence
  // of failed sources.
  test("case 2: --delete writes rows + removes only successful sources", () => {
    const repos = seedRepos()
    const res = runCli(["--root", smoke, "--delete"], env)
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/summary: imported=2 skipped=2 deleted=2/)

    const db = new Database(stateDb, { readonly: true })
    type Row = {
      worktree_path: string
      project_id: number
      project_name: string
      client_name: string | null
      task: string | null
    }
    const rows = db
      .query<
        Row,
        []
      >(
        "SELECT worktree_path, project_id, project_name, client_name, task FROM toggl_repo_state ORDER BY worktree_path;",
      )
      .all()
    db.close?.()
    const byPath = new Map(rows.map((r) => [r.worktree_path, r]))
    expect(byPath.size).toBe(2)

    expect(byPath.get(repos.a)).toMatchObject({
      project_id: 111,
      project_name: "Alpha",
      client_name: "Acme",
      task: "T-1",
    })
    // repo-b shape: client_name and task come back as NULL (DB null), proving
    // the `null` JSON value round-tripped losslessly.
    expect(byPath.get(repos.b)).toMatchObject({
      project_id: 222,
      project_name: "Beta",
      client_name: null,
      task: null,
    })

    // Source files: a/b removed; bad-json + missing-id retained for re-attempt.
    expect(() => statSync(join(smoke, "repo-a/.toggl"))).toThrow()
    expect(() => statSync(join(smoke, "repo-b/.toggl"))).toThrow()
    expect(statSync(join(smoke, "bad-json/.toggl")).isFile()).toBe(true)
    expect(statSync(join(smoke, "missing-id/.toggl")).isFile()).toBe(true)
  })

  // Case 3 — Missing root → warning, exit 0 (a missing root is not a hard error).
  test("case 3: missing root logs warning and exits 0", () => {
    const res = runCli(["--root", "/no/such/root", "--dry-run"], env)
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(
      /toggl-migrate: root \/no\/such\/root not found, skipping/,
    )
    expect(res.stdout).toMatch(
      /summary \(dry-run\): imported=0 skipped=0 deleted=0/,
    )
  })

  // Case 4 — Unknown flag → exit 1.
  test("case 4: unknown flag exits 1 with usage error", () => {
    const res = runCli(["--bogus"], env)
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/toggl-migrate: unknown argument: --bogus/)
  })
})
