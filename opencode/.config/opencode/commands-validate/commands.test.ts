// Content tests for the authored bam-* command files (Phase B of the plan).
// These live apart from validate.test.ts: that suite tests the validator
// itself, while this one tests the real command files in ../commands/.
import { describe, test, expect } from "bun:test";
import { validateCommand } from "./validate.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const commandsDir = join(import.meta.dir, "..", "commands");

// Mirror the validator's frontmatter strip so body assertions see only the
// prompt/template text, not the `description:`/`model:` keys.
function stripFrontmatter(content: string): string {
  const fm = content.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/);
  return fm ? content.slice(fm[0].length) : content;
}

describe("bam-review-task command", () => {
  test("exists, passes validateCommand, and body references task resolution + clarif… + stale/refresh", () => {
    const fileName = "bam-review-task.md";
    const filePath = join(commandsDir, fileName);

    // It must exist (authored in the matching GREEN step).
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf8");

    // It must satisfy the convention validator (zero issues).
    expect(validateCommand(fileName, content)).toEqual([]);

    // Its body must encode the review workflow: resolve the task, surface
    // clarifications/unblockers, and check whether it has gone stale.
    const body = stripFrontmatter(content).toLowerCase();
    expect(body).toContain("task");
    expect(/resolv/.test(body)).toBe(true); // task resolution
    expect(/clarif/.test(body)).toBe(true); // clarif…
    expect(/stale|refresh/.test(body)).toBe(true); // stale/refresh
  });
});

describe("bam-tdd-plan command", () => {
  test("exists, passes validateCommand, and body references separate test + trigger + Step N of M + model", () => {
    const fileName = "bam-tdd-plan.md";
    const filePath = join(commandsDir, fileName);

    // It must exist (authored in the matching GREEN step).
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf8");

    // It must satisfy the convention validator (zero issues).
    expect(validateCommand(fileName, content)).toEqual([]);

    // Its body must encode the TDD-plan shape: each step is a separate test,
    // test steps are distinct from implementation steps, every step carries a
    // trigger sentence of the form "Step N of M", and every step names a model.
    const body = stripFrontmatter(content).toLowerCase();
    expect(body).toContain("separate test"); // each step is a separate test
    expect(/trigger/.test(body)).toBe(true); // explicit trigger sentence per step
    expect(/step\s+`?n`?\s+of\s+`?m`?/.test(body)).toBe(true); // "Step N of M" (backticks optional)
    expect(/model/.test(body)).toBe(true); // every step names a model
  });
});

describe("bam-deploy-dev command", () => {
  test("exists, passes validateCommand, and body references commit + push + PR + base branch + Copilot + merge", () => {
    const fileName = "bam-deploy-dev.md";
    const filePath = join(commandsDir, fileName);

    // It must exist (authored in the matching GREEN step).
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf8");

    // It must satisfy the convention validator (zero issues).
    expect(validateCommand(fileName, content)).toEqual([]);

    // Its body must encode the deploy workflow: commit the work, push the
    // branch, open a PR against the correct base branch, run the Copilot
    // review loop, and only then merge.
    const body = stripFrontmatter(content).toLowerCase();
    expect(body).toContain("commit"); // commit the work
    expect(body).toContain("push"); // push the branch
    expect(/\bpr\b|pull request/.test(body)).toBe(true); // open a PR
    expect(/base branch/.test(body)).toBe(true); // verify the base branch (m, not main)
    expect(/copilot/.test(body)).toBe(true); // run the Copilot review loop
    expect(body).toContain("merge"); // merge once clean
  });
});

describe("bam-copilot-loop command", () => {
  test("exists, passes validateCommand, and body references @copilot + GraphQL/botIds + no new comments", () => {
    const fileName = "bam-copilot-loop.md";
    const filePath = join(commandsDir, fileName);

    // It must exist (authored in the matching GREEN step).
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf8");

    // It must satisfy the convention validator (zero issues).
    expect(validateCommand(fileName, content)).toEqual([]);

    // Its body must encode the Copilot re-trigger loop: re-request review via
    // the `@copilot` reviewer syntax, fall back to the GraphQL requestReviews
    // mutation with botIds, and loop until the review reads "no new comments".
    const body = stripFrontmatter(content).toLowerCase();
    expect(body).toContain("@copilot"); // gh pr edit --add-reviewer "@copilot"
    expect(/graphql/.test(body)).toBe(true); // GraphQL requestReviews fallback
    expect(/botids/.test(body)).toBe(true); // botIds: ["BOT_kgDOCnlnWA"], union: true
    expect(body).toContain("no new comments"); // loop exit signal
  });
});

describe("install wiring (Phase C)", () => {
  test("read opencode/install.sh; assert its FILES array contains commands", () => {
    const installPath = join(import.meta.dir, "..", "..", "..", "install.sh");
    const sh = readFileSync(installPath, "utf8");

    // capture the FILES=( ... ) array body
    const m = sh.match(/FILES=\(\s*([\s\S]*?)\s*\)/m);
    expect(m).not.toBeNull();

    const listed = (m![1] || "")
      .split(/\s+/)
      .map(l => l.trim())
      .filter(l => l && !l.startsWith("#"));

    // the whole-dir link for commands/ must be present (so new bam- cmds
    // deploy with no further installer changes)
    expect(listed).toContain("commands");
  });
});
