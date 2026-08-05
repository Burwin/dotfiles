// Content contract test for rules/no-ai-tells.md (Phase A step 1).
// Mirrors commands-validate/commands.test.ts style for rule files.
import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Mirror commands-validate style: strip frontmatter so body assertions test only prompt text.
function stripFrontmatter(content: string): string {
  const fm = content.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/);
  return fm ? content.slice(fm[0].length) : content;
}

const rulesDir = join(import.meta.dir, "..", "rules");
const rulePath = join(rulesDir, "no-ai-tells.md");

describe("no-ai-tells rule file", () => {
  test("exists and body documents hard ban on em dash (—), en dash (–), and prose --", () => {
    expect(existsSync(rulePath)).toBe(true);

    const content = readFileSync(rulePath, "utf8");
    const body = content.toLowerCase();

    expect(body).toContain("hard ban");
    expect(content).toContain("—");
    expect(content).toContain("–");
    expect(/prose.*--|--.*(prose|double|hyphen)/.test(body)).toBe(true);
    expect(/em dash|en dash/.test(body)).toBe(true);
  });

  test("body covers top tells — AI vocab (at least 3 of: delve, tapestry, testament, landscape, pivotal, showcase, underscore), significance inflation, negative parallelism / not X…Y, rule of three, chatbot tics (hope this helps / let me know / great question)", () => {
    const content = readFileSync(rulePath, "utf8");
    const body = content.toLowerCase();

    const aiVocab = ["delve", "tapestry", "testament", "landscape", "pivotal", "showcase", "underscore"];
    const vocabHits = aiVocab.filter((w) => body.includes(w)).length;
    expect(vocabHits).toBeGreaterThanOrEqual(3);

    expect(body).toContain("significance inflation");
    expect(/negative parallelism|not x.*y|it's not .* it|not .* it's/.test(body)).toBe(true);
    expect(/rule of three|rule-of-three/.test(body)).toBe(true);
    expect(/chatbot tic|hope this helps|let me know|great question/.test(body)).toBe(true);
  });

  test("states scope (all agent prose / chat + outbound) and exemptions (code, logs, quotes, user samples)", () => {
    const content = readFileSync(rulePath, "utf8");
    const body = content.toLowerCase();

    // scope: all agent prose, chat replies + outbound
    expect(/scope|applies to|all agent (written )?prose|chat replies? \+ outbound|chat \+ outbound/.test(body)).toBe(true);

    // exemptions documented
    expect(/exempt|exemption/.test(body)).toBe(true);
    expect(/code|logs|quotes|user samples?/.test(body)).toBe(true);
  });
});

describe("opencode.json wiring", () => {
  test("instructions array includes rules/no-ai-tells.md", () => {
    const configPath = join(import.meta.dir, "..", "opencode.json");
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(Array.isArray(config.instructions)).toBe(true);
    expect(config.instructions).toContain("rules/no-ai-tells.md");
  });
});

describe("communication.md + AGENTS.md wiring", () => {
  test("communication.md references no-ai-tells (or @rules/no-ai-tells.md); AGENTS.md always-loaded bullet lists rules/no-ai-tells.md", () => {
    const commPath = join(import.meta.dir, "..", "rules", "communication.md");
    const agentsPath = join(import.meta.dir, "..", "AGENTS.md");
    expect(existsSync(commPath)).toBe(true);
    expect(existsSync(agentsPath)).toBe(true);

    const comm = readFileSync(commPath, "utf8").toLowerCase();
    const agents = readFileSync(agentsPath, "utf8");

    // pointer like `@rules/brevity.md` or section mentioning it
    expect(/no-ai-tells|@rules\/no-ai-tells\.md/.test(comm)).toBe(true);

    // bullet under always-loaded list, e.g. - `rules/no-ai-tells.md`
    expect(/^\s*-\s*`rules\/no-ai-tells\.md`/m.test(agents)).toBe(true);
  });
});

describe("no-ai-tells skill", () => {
  test("exists; YAML frontmatter has `name: no-ai-tells` and `description` mentioning humanize / AI tells / em dash (or equivalent triggers)", () => {
    const skillPath = join(import.meta.dir, "..", "skills", "no-ai-tells", "SKILL.md");
    expect(existsSync(skillPath)).toBe(true);

    const content = readFileSync(skillPath, "utf8");
    // capture frontmatter block only (so body can't satisfy name/desc)
    const fmMatch = content.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/);
    expect(fmMatch).not.toBeNull();
    const frontmatter = fmMatch![1];

    expect(/^name:\s*no-ai-tells$/m.test(frontmatter)).toBe(true);
    expect(/description:/.test(frontmatter)).toBe(true);

    const fm = frontmatter.toLowerCase();
    expect(/humanize|ai tell|em dash|strip em|remove ai|make less ai/.test(fm)).toBe(true);
  });

  test("body encodes process (identify → rewrite → audit), hard dash ban, pattern checklist beyond the rule, exemptions, no-fabrication, and invocation modes (pasted / file / embedded)", () => {
    const skillPath = join(import.meta.dir, "..", "skills", "no-ai-tells", "SKILL.md");
    expect(existsSync(skillPath)).toBe(true);

    const content = readFileSync(skillPath, "utf8");
    const body = stripFrontmatter(content).toLowerCase();

    // process: identify → draft/rewrite → "still AI?" audit → final
    expect(/identify/.test(body)).toBe(true);
    expect(/rewrite|draft rewrite/.test(body)).toBe(true);
    expect(/audit|still ai\?|obviously ai generated/.test(body)).toBe(true);

    // hard dash ban (skill shows banned chars only in examples, like rule)
    expect(content).toContain("—");
    expect(content).toContain("–");
    expect(/prose.*--|--.*(prose|double|example)|word --/.test(content)).toBe(true);
    expect(/hard ban|em dash|en dash|no .*dash/.test(body)).toBe(true);

    // fuller pattern checklist (beyond rule's top 5 tells)
    expect(/checklist|patterns|content patterns|language patterns|style patterns/.test(body)).toBe(true);
    // at least one pattern not in the always-loaded rule (rule: vocab/significance/negative/rule-of-3/chatbot)
    expect(/filler|hedg|passive|copula|signpost|emoji|curly quote|boldface/.test(body)).toBe(true);

    // exemptions (same as rule) + voice-sample override note
    expect(/exempt|exemption/.test(body)).toBe(true);
    expect(/code|logs?|quotes?|user samples?|voice sample/.test(body)).toBe(true);
    expect(/voice sample|sample outrank|outrank.*dash/.test(body)).toBe(true);

    // no-fabrication rule
    expect(/no.?fabricat|fabrication|never add|do not (add|invent)|no facts|source only/.test(body)).toBe(true);

    // invocation modes
    expect(/pasted.*(text)?|file|embedded|invocation mode|modes?:/.test(body)).toBe(true);
  });
});
