// Content contract test for rules/plans.md grok tiers (MASTER-1989).
// Pins the two-tier table rewrite; mirrors MASTER-1848 token-pin style in commands-validate.
import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const baseDir = join(import.meta.dir, "..");

// Load inside the test (never at module init) so absence is a clean assertion failure.
function readText(rel: string): string {
  const p = join(baseDir, rel);
  expect(existsSync(p)).toBe(true);
  return readFileSync(p, "utf8");
}

function readJson(rel: string): any {
  return JSON.parse(readText(rel));
}

describe("plans.md grok tiers (MASTER-1989)", () => {
  test("contains Grok 4.6 + xai/grok-4.6; does not contain opencode/claude-opus-4-8 or opencode/glm-5.2", () => {
    const content = readText("rules/plans.md");

    // Pin the two-tier table: Grok 4.6 + xai/grok-4.6 present; old zen ids gone.
    expect(content).toContain("Grok 4.6");
    expect(content).toContain("xai/grok-4.6");
    expect(content).not.toContain("opencode/claude-opus-4-8");
    expect(content).not.toContain("opencode/glm-5.2");
  });
});

describe("AGENTS.md Plans section grok tiers (MASTER-1989)", () => {
  test("Plans section contains Grok 4.6 and does not contain Opus 4.8 or GLM 5.2", () => {
    const content = readText("AGENTS.md");

    // Pin the Plans intro to Grok 4.6; Opus/GLM must stay gone.
    const plansSection = (content.match(/## Plans([\s\S]*?)(?=\n## |$)/) || ["", content])[1];
    expect(plansSection).toContain("Grok 4.6");
    expect(plansSection).not.toContain("Opus 4.8");
    expect(plansSection).not.toContain("GLM 5.2");
  });
});

describe("opencode.json grok tiers (MASTER-1989)", () => {
  test("provider.opencode.blacklist is an array that includes every opus and glm id listed in Design", () => {
    const config = readJson("opencode.json");

    // Pin provider.opencode.blacklist to the opus + glm ids in Design.
    const bl = config?.provider?.opencode?.blacklist;
    expect(Array.isArray(bl)).toBe(true);
    expect(bl).toContain("claude-opus-4-1");
    expect(bl).toContain("claude-opus-4-5");
    expect(bl).toContain("claude-opus-4-6");
    expect(bl).toContain("claude-opus-4-7");
    expect(bl).toContain("claude-opus-4-8");
    expect(bl).toContain("claude-opus-5");
    expect(bl).toContain("glm-4.6");
    expect(bl).toContain("glm-4.7");
    expect(bl).toContain("glm-4.7-free");
    expect(bl).toContain("glm-5");
    expect(bl).toContain("glm-5-free");
    expect(bl).toContain("glm-5.1");
    expect(bl).toContain("glm-5.2");
  });

  test("provider.xai.models[\"grok-4.6\"] and provider.opencode.models[\"grok-4.6\"] have effort=high and xhigh.disabled=true", () => {
    const config = readJson("opencode.json");

    // Pin grok-4.6 default effort=high and xhigh disabled on both providers.
    const xaiG = config?.provider?.xai?.models?.["grok-4.6"];
    const opG = config?.provider?.opencode?.models?.["grok-4.6"];
    expect(xaiG?.options?.effort).toBe("high");
    expect(xaiG?.variants?.xhigh?.disabled).toBe(true);
    expect(opG?.options?.effort).toBe("high");
    expect(opG?.variants?.xhigh?.disabled).toBe(true);
  });
});
