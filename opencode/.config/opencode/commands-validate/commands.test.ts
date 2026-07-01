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

describe("bam-review-task interactive contract (MASTER-1848)", () => {
  // Load the command inside each test (never at describe/module-init) so a
  // missing file surfaces as a normal assertion failure instead of a load-time
  // throw — matching the existence-checked reads in the blocks above. Each test
  // pins one new behavior on a token that was newly-absent before MASTER-1848
  // (so its RED was clean).
  function readReviewTask(): {
    content: string;
    frontmatter: string;
    body: string;
  } {
    const filePath = join(commandsDir, "bam-review-task.md");
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf8");
    // Capture the inner text of the leading --- … --- block so frontmatter
    // assertions can't be satisfied by matching text in the body.
    const fm = content.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/);
    expect(fm).not.toBeNull();
    return {
      content,
      frontmatter: fm![1],
      body: stripFrontmatter(content).toLowerCase(),
    };
  }

  test("frontmatter declares agent: build", () => {
    const { frontmatter } = readReviewTask();
    // RED token: agent: build — was agent: plan. Pin it inside the frontmatter
    // block specifically, so a stray "agent: build" in the body (e.g. a code
    // fence) can't mask a frontmatter regression.
    expect(/^agent:\s*build$/m.test(frontmatter)).toBe(true);
  });

  test("body drives one-at-a-time Q&A via the `question` tool", () => {
    const { body } = readReviewTask();
    // RED tokens: "one at a time" + the literal `question` tool phrase. A plain
    // /question/ would also match "questions" in "open questions", so it
    // wouldn't actually pin use of the backticked tool.
    expect(/one at a time/.test(body)).toBe(true);
    expect(/`question` tool/.test(body)).toBe(true);
  });

  test("body offers a /bam-tdd-plan handoff (token bam-tdd-plan), not an inline plan", () => {
    const { body } = readReviewTask();
    // RED token: bam-tdd-plan (hand off, don't author inline)
    expect(/bam-tdd-plan/.test(body)).toBe(true);
  });

  test("body offers a confirmed card refresh — a plain-text comment plus a conditional description edit", () => {
    const { body } = readReviewTask();
    // §8 must offer BOTH writes, each confirm-gated. Pin them via the
    // §8-specific tool tokens — asana_add_comment for the comment,
    // asana_update_tasks for the description edit — rather than the bare words
    // "comment"/"description", which also occur in §4 ("last-comment dates",
    // "the description") and so wouldn't actually pin the §8 offers. Dropping
    // either write (or the confirm gate) now fails the test.
    expect(/confirm/.test(body)).toBe(true);
    expect(/asana_add_comment/.test(body)).toBe(true);
    expect(/asana_update_tasks/.test(body)).toBe(true);
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

describe("bam-resume command", () => {
  // Load the command inside each test (never at describe/module-init) so a
  // missing file surfaces as a normal assertion failure — following the
  // per-test-load pattern of readReviewTask() above — and additionally
  // re-assert the validator is clean on every read (a check readReviewTask()
  // does not make). Each test then pins one behavior via a token that was
  // newly-absent before its authoring GREEN, so the red→green history stayed
  // incremental.
  function readResume(): { content: string; frontmatter: string; body: string } {
    const fileName = "bam-resume.md";
    const filePath = join(commandsDir, fileName);
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf8");
    // Must satisfy the convention validator (zero issues) on every read.
    expect(validateCommand(fileName, content)).toEqual([]);
    // Capture the inner text of the leading --- … --- block so frontmatter
    // assertions can't be satisfied by matching text in the body.
    const fm = content.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/);
    expect(fm).not.toBeNull();
    return {
      content,
      frontmatter: fm![1],
      body: stripFrontmatter(content).toLowerCase(),
    };
  }

  test("exists, validates, and frontmatter is `agent: build` with no `model:` line", () => {
    const { frontmatter } = readResume();
    // agent: build with no model: line (the tier is chosen per session, per step).
    expect(/^agent:\s*build$/m.test(frontmatter)).toBe(true);
    expect(/^model:/m.test(frontmatter)).toBe(false);
  });

  test("body encodes card + plan resolution (§1–§2)", () => {
    const { body } = readResume();
    // /resolv/ = resolution, /docs\/plans/ = plan file, /\bask\b/ = the
    // "else list + ask" fallback. Word-boundary the "ask" so it pins a real
    // ask (e.g. "ask the human", "else ask") rather than matching "task",
    // which pervades the body and would make this assertion a false positive.
    expect(/resolv/.test(body)).toBe(true);
    expect(/docs\/plans/.test(body)).toBe(true);
    expect(/\bask\b/.test(body)).toBe(true);
  });

  test("body finds the next step via the prior session's last-posted trigger (§3)", () => {
    const { body } = readResume();
    // /trigger/ + BOTH halves of the §3 read (list the sessions, then export
    // the chosen transcript) + /transcript/. Assert each step separately so a
    // regression that drops one — leaving only `session list` or only
    // `opencode export` — is caught, rather than an either-or that passes on
    // half the flow.
    expect(/trigger/.test(body)).toBe(true);
    expect(/session list/.test(body)).toBe(true); // step 1: list sessions
    expect(/opencode export/.test(body)).toBe(true); // step 2: export transcript
    expect(/transcript/.test(body)).toBe(true);
  });

  test("body model-tier-checks, then confirms before executing (§4–§5)", () => {
    const { body } = readResume();
    // /tier/ + /mismatch/ warn-ask + /confirm/ gate before running the step.
    expect(/tier/.test(body)).toBe(true);
    expect(/mismatch/.test(body)).toBe(true);
    expect(/confirm/.test(body)).toBe(true);
  });

  test("body runs exactly one step, then posts the next trigger and stops (§6–§7)", () => {
    const { body } = readResume();
    // /one step/ boundary + /next …trigger/ handoff + /stop/.
    expect(/one step/.test(body)).toBe(true);
    expect(/next .*trigger|next step's trigger/.test(body)).toBe(true);
    expect(/stop/.test(body)).toBe(true);
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
