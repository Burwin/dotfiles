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

    // RED tokens (step 1): assert the target two-tier shape.
    // "Grok 4.6" + "xai/grok-4.6" are newly absent; the opus/glm ids must be gone.
    // Avoid tokens that already appear today ("Grok Build 0.1", "tier", "model", etc).
    expect(content).toContain("Grok 4.6");
    expect(content).toContain("xai/grok-4.6");
    expect(content).not.toContain("opencode/claude-opus-4-8");
    expect(content).not.toContain("opencode/glm-5.2");
  });
});

describe("AGENTS.md Plans section grok tiers (MASTER-1989)", () => {
  test("Plans section contains Grok 4.6 and does not contain Opus 4.8 or GLM 5.2", () => {
    const content = readText("AGENTS.md");

    // RED token (step 7): assert the Plans section now names only the two Grok tiers.
    // "Grok 4.6" is newly absent; Opus/GLM strings must be gone.
    // Target specifically the model tier list in the Plans intro para.
    // Avoid tokens that already appear ("Grok Build 0.1", "model tier", "tiers").
    const plansSection = (content.match(/## Plans([\s\S]*?)(?=\n## |$)/) || ["", content])[1];
    expect(plansSection).toContain("Grok 4.6");
    expect(plansSection).not.toContain("Opus 4.8");
    expect(plansSection).not.toContain("GLM 5.2");
  });
});

describe("opencode.json grok tiers (MASTER-1989)", () => {
  test("provider.opencode.blacklist is an array that includes every opus and glm id listed in Design", () => {
    const config = readJson("opencode.json");

    // RED token (step 9): assert provider.opencode.blacklist is array containing all listed ids.
    // blacklist + the specific opus/glm ids are newly absent (no key today).
    // Load inside the test so absence is clean assertion failure.
    // Avoid tokens that already appear ("Grok Build 0.1", "model", "tier").
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

    // RED token (step 11): assert grok-4.6 options.effort==="high" + variants.xhigh.disabled===true under xai and opencode.
    // xai block, grok-4.6, effort, disabled (for xhigh) newly absent.
    // Avoid tokens already present ("Grok Build 0.1", "blacklist").
    const xaiG = config?.provider?.xai?.models?.["grok-4.6"];
    const opG = config?.provider?.opencode?.models?.["grok-4.6"];
    expect(xaiG?.options?.effort).toBe("high");
    expect(xaiG?.variants?.xhigh?.disabled).toBe(true);
    expect(opG?.options?.effort).toBe("high");
    expect(opG?.variants?.xhigh?.disabled).toBe(true);
  });
});
