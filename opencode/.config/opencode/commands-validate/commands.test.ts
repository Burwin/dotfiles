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

describe("bam-tdd-plan grok tiers (MASTER-1989)", () => {
  test("body contains Grok 4.6; does not contain three tiers", () => {
    const filePath = join(commandsDir, "bam-tdd-plan.md");
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf8");
    const body = stripFrontmatter(content).toLowerCase();
    expect(body).toContain("grok 4.6");
    expect(body).not.toContain("three tiers");
  });
});

describe("bam-resume grok tiers (MASTER-1989)", () => {
  test("§4's example list contains Grok 4.6 + Grok Build 0.1; does not contain Opus 4.8 or GLM 5.2", () => {
    const filePath = join(commandsDir, "bam-resume.md");
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf8");
    const body = stripFrontmatter(content);
    // pin specifically §4's list (newly-absent "grok 4.6" + "grok build 0.1"; old tiers must be gone)
    const s4 = (body.match(/## 4\. .*?([\s\S]*?)(?=\n## \d\. |$)/) || ["", body])[1].toLowerCase();
    expect(s4).toContain("grok 4.6");
    expect(s4).toContain("grok build 0.1");
    expect(s4).not.toContain("opus 4.8");
    expect(s4).not.toContain("glm 5.2");
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

describe("bam-specs-init command", () => {
  // Load the command inside each test (never at describe/module-init) so a
  // missing file surfaces as a normal assertion failure — same pattern as
  // readResume() above — and re-assert the validator is clean on every read.
  // Each test pins one behavior via a token that was newly-absent before its
  // authoring GREEN, so the red→green history stayed incremental.
  function readBamSpecsInit(): { content: string; frontmatter: string; body: string } {
    const fileName = "bam-specs-init.md";
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

  test("exists, validates, and frontmatter is `agent: plan` with no `model:` line", () => {
    const { frontmatter } = readBamSpecsInit();
    // agent: plan with no model: line (the user picks the session model;
    // recommend Grok 4.6, but do not pin it).
    expect(/^agent:\s*plan$/m.test(frontmatter)).toBe(true);
    expect(/^model:/m.test(frontmatter)).toBe(false);
  });

  test("body encodes target resolution (§1)", () => {
    const { body } = readBamSpecsInit();
    // path / prefix / scope from $ARGUMENTS; git toplevel; constitution.md
    // first-vs-append branch. Bare /path/ is noisy but the conjunction of all
    // five is what pins §1; dropping any one (e.g. no git toplevel check)
    // fails the test.
    expect(/path/.test(body)).toBe(true);
    expect(/prefix/.test(body)).toBe(true);
    expect(/scope/.test(body)).toBe(true);
    expect(/constitution\.md/.test(body)).toBe(true);
    expect(/git rev-parse --show-toplevel/.test(body)).toBe(true);
  });

  test("body encodes ID scheme (§2)", () => {
    const { body } = readBamSpecsInit();
    // flat default; multi-section as opt-in (not the default). All three
    // tokens required so a body that only names "flat" without the opt-in
    // escape hatch fails.
    expect(/flat/.test(body)).toBe(true);
    expect(/multi-section/.test(body)).toBe(true);
    expect(/opt-in/.test(body)).toBe(true);
  });

  test("body points at PLAN output + templates (§3)", () => {
    const { body } = readBamSpecsInit();
    // docs/plans output path; 1945 primary + 1943 precedent; PLAN.md as the
    // file to write. plan.md is lowercased by stripFrontmatter.
    expect(/docs\/plans/.test(body)).toBe(true);
    expect(/1945/.test(body)).toBe(true);
    expect(/1943/.test(body)).toBe(true);
    expect(/plan\.md/.test(body)).toBe(true);
  });

  test("body encodes the init loop (§3)", () => {
    const { body } = readBamSpecsInit();
    // harvest → refine → sweep → ratify → fan-out. Assert each step
    // separately so dropping one from the authored-PLAN table fails.
    expect(/harvest/.test(body)).toBe(true);
    expect(/refine/.test(body)).toBe(true);
    expect(/sweep/.test(body)).toBe(true);
    expect(/ratify/.test(body)).toBe(true);
    expect(/fan-out/.test(body)).toBe(true);
  });

  test("body encodes first-vs-append + review contract (§3)", () => {
    const { body } = readBamSpecsInit();
    // conventions header + AGENTS.md policy; the four verdicts; ≤5/gate.
    // Pin accept/edit/drop/unsure each so a body that only says "accept"
    // does not satisfy the review contract.
    expect(/conventions/.test(body)).toBe(true);
    expect(/agents\.md/.test(body)).toBe(true);
    expect(/accept/.test(body)).toBe(true);
    expect(/edit/.test(body)).toBe(true);
    expect(/drop/.test(body)).toBe(true);
    expect(/unsure/.test(body)).toBe(true);
    expect(/≤5|<=5|at most 5/.test(body)).toBe(true);
  });

  test("body posts kickoff, stops, defers resume, excludes amend (§4)", () => {
    const { body } = readBamSpecsInit();
    // kickoff trigger; stop; later via /bam-resume; amend only as
    // out-of-scope (name /bam-specs-amend, not as something this
    // command does).
    expect(/trigger/.test(body)).toBe(true);
    expect(/bam-resume/.test(body)).toBe(true);
    expect(/stop/.test(body)).toBe(true);
    expect(/bam-specs-amend/.test(body)).toBe(true);
    expect(/out of scope/.test(body)).toBe(true);
  });
});

describe("bam-specs-amend command", () => {
  // Load the command inside each test (never at describe/module-init) so a
  // missing file surfaces as a normal assertion failure — same pattern as
  // readBamSpecsInit() above — and re-assert the validator is clean on every read.
  // Each test pins one behavior via a token that was newly-absent before its
  // authoring GREEN, so the red→green history stayed incremental.
  function readBamSpecsAmend(): { content: string; frontmatter: string; body: string } {
    const fileName = "bam-specs-amend.md";
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
    const { frontmatter } = readBamSpecsAmend();
    // agent: build with no model: line (the user picks the session model;
    // recommend Grok 4.6, but do not pin it).
    expect(/^agent:\s*build$/m.test(frontmatter)).toBe(true);
    expect(/^model:/m.test(frontmatter)).toBe(false);
  });

  test("body encodes ticket resolution (§1)", () => {
    const { body } = readBamSpecsAmend();
    // §1-specific: asana_search_tasks plus permalink_url / project membership
    // confirmation. Bare asana/task/resolv also appear in the intro and
    // $ARGUMENTS line, so they would stay green if §1 itself regressed.
    expect(/asana_search_tasks/.test(body)).toBe(true);
    expect(/permalink_url/.test(body)).toBe(true);
    expect(/project membership/.test(body)).toBe(true);
  });

  test("body encodes target resolution (§2)", () => {
    const { body } = readBamSpecsAmend();
    // constitution.md must already exist; git toplevel for the cwd default.
    // Conjunction of both so a body that names the law file without checking
    // git toplevel fails.
    expect(/constitution\.md/.test(body)).toBe(true);
    expect(/git rev-parse --show-toplevel/.test(body)).toBe(true);
  });

  test("body aborts to init (§2b)", () => {
    const { body } = readBamSpecsAmend();
    // missing constitution.md or new prefix/section → abort and point the
    // human at /bam-specs-init. Name init only as the abort target.
    expect(/bam-specs-init/.test(body)).toBe(true);
    expect(/abort|never init|do not re-init/.test(body)).toBe(true);
  });

  test("body drives stakeholder Q&A (§3)", () => {
    const { body } = readBamSpecsAmend();
    // one at a time + the literal `question` tool phrase + stakeholder AND
    // user perspective. Pin both so "stakeholder" alone does not satisfy.
    expect(/one at a time/.test(body)).toBe(true);
    expect(/`question` tool/.test(body)).toBe(true);
    expect(/stakeholder/.test(body)).toBe(true);
    expect(/user perspective/.test(body)).toBe(true);
  });

  test("body encodes the amendment table (§4)", () => {
    const { body } = readBamSpecsAmend();
    // table header row plus both replace-pair action keywords. Header so
    // "task id" elsewhere does not satisfy; both keywords so "replace"
    // alone does not.
    expect(/\| id \| description \| action \|/.test(body)).toBe(true);
    expect(/replace with/.test(body)).toBe(true);
    expect(/replaces/.test(body)).toBe(true);
  });

  test("body iterates until accepted (§5)", () => {
    const { body } = readBamSpecsAmend();
    // keep / modify / drop rows; loop until the human accepts the table.
    expect(/iterate/.test(body)).toBe(true);
    expect(/accept/.test(body)).toBe(true);
  });

  test("body commits constitution.md and excludes tests/cards (§6)", () => {
    const { body } = readBamSpecsAmend();
    // stage only constitution.md; tests and cards out of scope. Pin each
    // so a body that commits without excluding tests/cards fails.
    expect(/git add/.test(body)).toBe(true);
    expect(/commit/.test(body)).toBe(true);
    expect(/tests/.test(body)).toBe(true);
    expect(/cards/.test(body)).toBe(true);
    expect(/out of scope/.test(body)).toBe(true);
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
