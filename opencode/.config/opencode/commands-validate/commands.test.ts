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

describe("bam-tdd-plan cheap/premium tiers (MASTER-2033)", () => {
  test("body contains **cheap** and **premium**; does not contain Grok 4.6; still does not contain three tiers", () => {
    const filePath = join(commandsDir, "bam-tdd-plan.md");
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf8");
    const body = stripFrontmatter(content).toLowerCase();
    expect(body).toContain("**cheap**");
    expect(body).toContain("**premium**");
    expect(body).not.toContain("grok 4.6");
    expect(body).not.toContain("three tiers");
  });
});

describe("bam-resume cheap/premium tiers (MASTER-2033)", () => {
  test("§4 contains `cheap` and `premium` and does not contain `Grok 4.6`; keep Opus 4.8 / GLM 5.2 absent", () => {
    const filePath = join(commandsDir, "bam-resume.md");
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf8");
    const body = stripFrontmatter(content);
    const s4 = (body.match(/## 4\. .*?([\s\S]*?)(?=\n## \d\. |$)/) || ["", body])[1].toLowerCase();
    expect(s4).toContain("cheap");
    expect(s4).toContain("premium");
    expect(s4).not.toContain("grok 4.6");
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
    // missing constitution.md or new prefix/section → abort, write nothing,
    // point at /bam-specs-init. Pin the abort-only phrase so "never init"
    // in the intro does not satisfy §2b.
    expect(/bam-specs-init/.test(body)).toBe(true);
    expect(/do not write anything/.test(body)).toBe(true);
    expect(/never init/.test(body)).toBe(true);
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
    // keep / modify / drop is §5-specific; iterate/accept also appear in
    // the intro, so they would stay green if §5 itself disappeared.
    expect(/keep \/ modify \/ drop/.test(body)).toBe(true);
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

describe("bam-specs-gaps command", () => {
  // Load the command inside each test (never at describe/module-init) so a
  // missing file surfaces as a normal assertion failure — same pattern as
  // readBamSpecsAmend() above — and re-assert the validator is clean on every read.
  // Each test pins one behavior via a focused token.
  function readBamSpecsGaps(): { content: string; frontmatter: string; body: string } {
    const fileName = "bam-specs-gaps.md";
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

  function sliceSection(body: string, re: RegExp): string {
    const match = body.match(re);
    expect(match).not.toBeNull();
    return match![1];
  }

  function slice3(body: string): string {
    return sliceSection(body, /## 3\. .*?([\s\S]*?)(?=\n## \d\. |$)/);
  }

  function slice4(body: string): string {
    return sliceSection(body, /## 4\. .*?([\s\S]*?)(?=\n## \d\. |$)/);
  }

  function slice5(body: string): string {
    return sliceSection(body, /## 5\. .*?([\s\S]*?)(?=\n## \d\. |$)/);
  }

  function slice5a(body: string): string {
    return sliceSection(body, /### 5a\. .*?([\s\S]*?)(?=\n### 5b\. |$)/);
  }

  function slice5b(body: string): string {
    return sliceSection(body, /### 5b\. .*?([\s\S]*?)(?=\n### 5c\. |\n## \d\. |$)/);
  }

  function slice5c(body: string): string {
    return sliceSection(body, /### 5c\. .*?([\s\S]*?)(?=\n## \d\. |$)/);
  }

  function slice6(body: string): string {
    return sliceSection(body, /## 6\. .*?([\s\S]*?)(?=\n## \d\. |$)/);
  }

  test("exists, validates, and frontmatter is `agent: build` with no `model:` line", () => {
    const { frontmatter } = readBamSpecsGaps();
    // agent: build with no model: line (the user picks the session model;
    // recommend Grok 4.6, but do not pin it).
    expect(/^agent:\s*build$/m.test(frontmatter)).toBe(true);
    expect(/^model:/m.test(frontmatter)).toBe(false);
  });

  test("body encodes target resolution (§1)", () => {
    const { body } = readBamSpecsGaps();
    // §1-specific: the law file at the target root, git toplevel for the
    // cwd default, and the abort target when the law is absent. All three
    // required so a body that names the law file without the init abort
    // fails.
    expect(/constitution\.md/.test(body)).toBe(true);
    expect(/git rev-parse --show-toplevel/.test(body)).toBe(true);
    expect(/bam-specs-init/.test(body)).toBe(true);
  });

  test("body encodes scope (§2)", () => {
    const { body } = readBamSpecsGaps();
    // §2-specific: whole-law default plus the optional prefix/section
    // filter for large repos. All four required so a body that states the
    // whole-law default without the filter escape hatch fails.
    expect(/whole/.test(body)).toBe(true);
    expect(/prefix/.test(body)).toBe(true);
    expect(/section/.test(body)).toBe(true);
    expect(/filter/.test(body)).toBe(true);
  });

  test("body defines proper test (§3a)", () => {
    const { body } = readBamSpecsGaps();
    // §3a-specific: proper test = an automated test that asserts the rule
    // holds; docs/process notes count only in the rare case where a test
    // does not make sense. All three required so a body that names test
    // kinds without the automated-first rule and the rare docs escape
    // fails.
    expect(/automated/.test(body)).toBe(true);
    expect(/assert/.test(body)).toBe(true);
    expect(/rare/.test(body)).toBe(true);
  });

  test("a live rule is covered only if a test mentions that ID in the name, fact title, comment, or assert message (§3)", () => {
    const { body } = readBamSpecsGaps();
    // §3 coverage signal: ID mention (name / fact title / comment / assert).
    // Keep §3a proper-test pin as-is.
    const s3 = slice3(body);
    expect(/mention/.test(s3)).toBe(true);
    expect(/fact title/.test(s3)).toBe(true);
    expect(/exact id/.test(s3)).toBe(true);
    expect(/assert message/.test(s3)).toBe(true);
    expect(/name, fact title, comment/.test(s3)).toBe(true);
    expect(/standalone/.test(s3)).toBe(true);
    expect(/stray/.test(s3)).toBe(true);
  });

  test("scans live IDs only; skips [CANCELLED] / [REPLACED_BY] (§3)", () => {
    const { body } = readBamSpecsGaps();
    // Only live rules are in scope. Skip [CANCELLED] and [REPLACED_BY].
    const s3 = slice3(body);
    expect(/cancelled/.test(s3)).toBe(true);
    expect(/replaced_by/.test(s3)).toBe(true);
    expect(/skip/.test(s3)).toBe(true);
    expect(/\[cancelled\]/.test(s3)).toBe(true);
    expect(/\[replaced_by:/.test(s3)).toBe(true);
  });

  test("leftover pin = exact dead-ID mention only, not unlabeled leftover behavior (§3)", () => {
    const { body } = readBamSpecsGaps();
    // Leftover pin = exact dead-ID mention (name / fact title / comment /
    // assert). Unlabeled leftover behavior is not a leftover pin.
    const s3 = slice3(body);
    expect(/leftover/.test(s3)).toBe(true);
    expect(/exact mention of that dead id/.test(s3)).toBe(true);
    expect(/dead id as a standalone token/.test(s3)).toBe(true);
    expect(/search the same locations/.test(s3)).toBe(true);
    expect(/unlabeled leftover behavior is not/.test(s3)).toBe(true);
  });

  test("leftover mentions go on the same gap list, tagged cleanup (§4)", () => {
    const { body } = readBamSpecsGaps();
    // Leftover mentions on dead IDs produce cleanup rows on the same §4
    // gap list. Scope /cleanup/ to slice4.
    const s4 = slice4(body);
    expect(/cleanup/.test(s4)).toBe(true);
    expect(/tagged cleanup/.test(s4)).toBe(true);
    expect(/dead-id/.test(s4)).toBe(true);
    expect(/why.*leftover mention/.test(s4)).toBe(true);
    expect(/gist/.test(s4)).toBe(true);
    expect(/file:line/.test(s4)).toBe(true);
    expect(/every matching leftover location/.test(s4)).toBe(true);
    expect(/locations searched/.test(s4)).toBe(true);
  });

  test("dead ID with no leftover mention is omitted (not a gap row) (§3)", () => {
    const { body } = readBamSpecsGaps();
    // Dead ID with no mention in tests is omitted from the gap list.
    // Token /omit/. Scope to slice3. Do not pin /silent/.
    const s3 = slice3(body);
    expect(/omit a dead id with no leftover mention/.test(s3)).toBe(true);
  });

  test("if a test already pins the rule but does not mention the ID, add the mention; do not put that rule on the gap list (§3/§4)", () => {
    const { body } = readBamSpecsGaps();
    // A proper-test pin without the ID gets the mention written onto that
    // test; it is not a gap. Scope the write token to §3.
    const s3 = slice3(body);
    expect(/add the mention/.test(s3)).toBe(true);
    expect(/not a gap/.test(s3)).toBe(true);
    expect(/already pins/.test(s3)).toBe(true);
    expect(/asserts the rule/.test(s3)).toBe(true);
    const s4 = slice4(body);
    expect(/no id-token hit/.test(s4)).toBe(true);
    expect(/unlabeled-but-pinning never appears/.test(s4)).toBe(true);
    expect(/rare/.test(s4)).toBe(true);
  });

  test("adding mentions waits for one confirm per run (question tool, recommended default first) (§3)", () => {
    const { body } = readBamSpecsGaps();
    // Unlabeled-but-pinning writes wait for one confirm per run via the
    // `question` tool, recommended default first. Pin the phrase so §1's
    // path `confirm` cannot satisfy this.
    const s3 = slice3(body);
    expect(/one confirm/.test(s3)).toBe(true);
    expect(/`question` tool/.test(s3)).toBe(true);
    expect(/recommended default first/.test(s3)).toBe(true);
    expect(/not per id/.test(s3)).toBe(true);
    expect(/yes\/no/.test(s3)).toBe(true);
    expect(/add-only/.test(s3)).toBe(true);
    expect(/file:line/.test(s3)).toBe(true);
    expect(/do not change test logic/.test(s3)).toBe(true);
  });

  test("body diffs each rule and lists the gaps (§3b/§4)", () => {
    const { body } = readBamSpecsGaps();
    // §3b/§4-specific: per-rule diff against tests/suites/CI, then a gap
    // list with searched locations. All three required so a body that
    // defines a proper test without diffing each rule and listing the
    // misses with where it looked fails.
    expect(/gap/.test(body)).toBe(true);
    expect(/list/.test(body)).toBe(true);
    expect(/searched|locations searched/.test(body)).toBe(true);
  });

  test("body asks filing mode without silent auto-create (§5a)", () => {
    const { body } = readBamSpecsGaps();
    // §5a-specific: ask filing mode every run via the `question` tool one
    // at a time, never filing silently. All four required so a body that
    // only asks a `question` elsewhere (e.g. the §2 filter clarify) without
    // the filing-mode ask and the no-silent rule fails.
    expect(/`question` tool/.test(body)).toBe(true);
    expect(/one at a time/.test(body)).toBe(true);
    expect(/filing/.test(body)).toBe(true);
    expect(/silently|do not auto-create/.test(body)).toBe(true);
  });

  test("body defaults §5b to one-plan /bam-tdd-plan handoff (§5b)", () => {
    const { body } = readBamSpecsGaps();
    // §5b default: handoff via /bam-tdd-plan (one plan on current card + code).
    // Scope to ### 5b so asana_create_tasks negative stays scoped (per-gap
    // brings the token back under §5c).
    const s5b = slice5b(body);
    expect(/bam-tdd-plan/.test(s5b)).toBe(true);
    expect(/handoff/.test(s5b)).toBe(true);
    expect(/one plan/.test(s5b)).toBe(true);
    expect(/current card/.test(s5b)).toBe(true);
    expect(/code/.test(s5b)).toBe(true);
    expect(s5b).not.toContain("asana_create_tasks");
  });

  test("default handoff is copy-paste into a fresh session, never a plan file, never a plan subtask (§5b)", () => {
    const { body } = readBamSpecsGaps();
    // Mirror review-task §7: paste snippet for a fresh session; never writes
    // plan.md; never files a plan subtask. Scope to ### 5b.
    const s5b = slice5b(body);
    expect(/paste/.test(s5b)).toBe(true);
    expect(/fresh session/.test(s5b)).toBe(true);
    expect(/never writes a [`']?plan\.md/.test(s5b)).toBe(true);
    expect(/never creates a plan subtask/.test(s5b)).toBe(true);
    expect(/do not invoke/.test(s5b)).toBe(true);
  });

  test("snippet includes resolved card GID + the gap list; question options are handoff (default), list-only, per-gap cards; per-gap is the `asana_create_tasks` path (§5)", () => {
    const { body } = readBamSpecsGaps();
    // Default snippet: resolved card GID + the gap list. 5a names the three
    // modes (handoff default). per-gap is the only asana_create_tasks path.
    const s5 = slice5(body);
    const s5a = slice5a(body);
    const s5b = slice5b(body);
    expect(/task-id/.test(s5b)).toBe(true);
    expect(/gid/.test(s5b)).toBe(true);
    expect(/summary/.test(s5b)).toBe(true);
    expect(/gap list/.test(s5b)).toBe(true);
    expect(/row-handling rules/.test(s5b)).toBe(true);
    expect(/do not guess/.test(s5b)).toBe(true);
    expect(/permalink/.test(s5b)).toBe(true);
    expect(/handoff/.test(s5a)).toBe(true);
    expect(/list-only/.test(s5a)).toBe(true);
    expect(/per-gap/.test(s5a)).toBe(true);
    expect(/asana_create_tasks/.test(s5)).toBe(true);
    expect(/per-gap.*asana_create_tasks|asana_create_tasks.*per-gap/.test(s5)).toBe(true);
  });

  test("cleanup rows in the handoff mean remove leftover tests + orphaned production code; living successors stay new-tests-plus-code (§5)", () => {
    const { body } = readBamSpecsGaps();
    // Cleanup handoff = remove tests + orphaned code; successors stay add.
    // Tokens: /orphaned/, /successor/. Scope to ## 5. Keep /code/ and /bam-tdd-plan/.
    const s5 = slice5(body);
    const s5b = slice5b(body);
    expect(/orphaned/.test(s5)).toBe(true);
    expect(/successor/.test(s5)).toBe(true);
    expect(/preserve or split/.test(s5b)).toBe(true);
    expect(/do not add new tests/.test(s5b)).toBe(true);
    expect(/new-tests-plus-code/.test(s5b)).toBe(true);
    expect(/no remaining callers/.test(s5b)).toBe(true);
    const s5c = slice5c(body);
    expect(/cleanup cards/.test(s5c)).toBe(true);
    expect(/preserving or splitting/.test(s5c)).toBe(true);
    expect(/no-remaining-callers/.test(s5c)).toBe(true);
    // keep the prior pins that live in §5b (per step instruction)
    expect(/code/.test(s5b)).toBe(true);
    expect(/bam-tdd-plan/.test(s5b)).toBe(true);
  });

  test("body states relations + stop (§6)", () => {
    const { body } = readBamSpecsGaps();
    // Stop after handoff snippet, list-only, or per-gap filing. Keep
    // /do not implement/. Intro must not sell "file cards" as the default.
    // Several tokens also appear in intro, so conjunction requires §6.
    expect(/bam-specs-init/.test(body)).toBe(true);
    expect(/bam-specs-amend/.test(body)).toBe(true);
    expect(/runnable after/.test(body)).toBe(true);
    const s6 = slice6(body);
    expect(/stop/.test(s6)).toBe(true);
    expect(/stop after.*(handoff|snippet|list-only|per-gap)/.test(s6)).toBe(true);
    expect(/do not implement/.test(s6)).toBe(true);
    expect(/missing tests/.test(s6)).toBe(true);
    expect(/missing code/.test(s6)).toBe(true);
    // Allowed write is ID mentions on existing tests; missing tests/code stay
    // out of scope. Pin scoped to ## 6.
    expect(/existing tests/.test(s6)).toBe(true);
    // This command lists only; tdd-plan specifies the deletes; mentions
    // stay the only write. Scope /deletes/ to ## 6. Keep /do not implement/
    // and /existing tests/. The stale "tdd-plan does the deletes" phrase
    // must stay absent.
    expect(/lists only/.test(s6)).toBe(true);
    expect(/tdd-plan does the deletes/.test(s6)).toBe(false);
    expect(/mentions stay the only write/.test(s6)).toBe(true);
    expect(/deletes/.test(s6)).toBe(true);
    expect(/per-gap asana card creation/.test(s6)).toBe(true);
    expect(/specifies the deletes/.test(s6)).toBe(true);
    const intro = body.split(/\n## /)[0];
    expect(/file cards/.test(intro)).toBe(false);
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
