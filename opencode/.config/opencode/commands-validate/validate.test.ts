import { describe, test, expect } from "bun:test";
import { validateCommand, validateAll } from "./validate.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixturesDir = join(import.meta.dir, "fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

describe("validateCommand", () => {
  test("flags a file whose name violates bam-…kebab….md", () => {
    const fileName = "bad-name.md";
    const content = loadFixture(fileName);
    const issues = validateCommand(fileName, content);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some(i => /name|filename|kebab|bam-/i.test(i.problem))).toBe(true);
    // also check the issue references the file
    expect(issues[0].file).toBe(fileName);
  });

  test("flags missing/unparseable frontmatter AND missing/empty description (fixture bad-no-description.md)", () => {
    const fileName = "bam-no-desc.md"; // valid filename so we test content rules
    const content = loadFixture("bad-no-description.md");
    const issues = validateCommand(fileName, content);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some(i => /frontmatter|unpars(e)?able|parse/i.test(i.problem))).toBe(true);
    expect(issues.some(i => /description/i.test(i.problem))).toBe(true);
    expect(issues.every(i => i.file === fileName)).toBe(true);
  });

  test("flags an empty body (frontmatter only, no template text)", () => {
    const fileName = "bam-empty-body.md"; // valid filename so we test content rules
    const content = loadFixture("bad-empty-body.md");
    const issues = validateCommand(fileName, content);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some(i => /body|empty|template|prompt/i.test(i.problem))).toBe(true);
    expect(issues.every(i => i.file === fileName)).toBe(true);
  });

  test("flags a bad model (no /) and an unknown agent, but allows their absence", () => {
    const fileName = "bam-test-model-agent.md"; // valid filename

    // bad model: no slash
    const badModel = `---
description: has desc
model: grok-build-0.1
---
some body text`;

    let issues = validateCommand(fileName, badModel);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some(i => /model/i.test(i.problem))).toBe(true);
    expect(issues.every(i => i.file === fileName)).toBe(true);

    // unknown agent
    const badAgent = `---
description: has desc
agent: foo
---
some body text`;

    issues = validateCommand(fileName, badAgent);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some(i => /agent/i.test(i.problem))).toBe(true);

    // absence is allowed (no model/agent keys at all)
    const noModelNoAgent = `---
description: has desc
---
some body text here`;

    issues = validateCommand(fileName, noModelNoAgent);
    expect(issues.length).toBe(0);
  });

  test("happy path bam-good-example.md produces zero issues", () => {
    const fileName = "bam-good-example.md";
    const content = loadFixture("bam-good-example.md");
    const issues = validateCommand(fileName, content);
    expect(issues).toEqual([]);
  });
});

describe("validateAll", () => {
  test("validateAll(fixtures) returns issues for the bad fixtures and none for the good one", () => {
    const issues = validateAll(fixturesDir);

    const bads = issues.filter(i => i.file.startsWith("bad-"));
    const goods = issues.filter(i => i.file === "bam-good-example.md");

    expect(bads.length).toBeGreaterThan(0);
    expect(goods.length).toBe(0);

    // ensure we saw issues from each bad fixture (at least one per)
    const badFilesSeen = new Set(bads.map(i => i.file));
    expect(badFilesSeen.has("bad-name.md")).toBe(true);
    expect(badFilesSeen.has("bad-no-description.md")).toBe(true);
    expect(badFilesSeen.has("bad-empty-body.md")).toBe(true);
  });

  test("surfaces an issue (not an empty list) when the directory can't be read", () => {
    const issues = validateAll(join(fixturesDir, "does-not-exist-xyz"));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some(i => /cannot read|directory/i.test(i.problem))).toBe(true);
  });
});
