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

describe("plans.md grok tiers (MASTER-2033)", () => {
  test("contains openrouter/cheap + openrouter/premium + Grok 4.6; does not contain xai/grok-4.6 or opencode/grok-build-0.1; still does not contain opus/glm", () => {
    const content = readText("rules/plans.md");

    // Pin the two-tier table: openrouter/cheap + openrouter/premium + legacy Grok 4.6 note; old ids gone. Opus/GLM still absent.
    expect(content).toContain("openrouter/cheap");
    expect(content).toContain("openrouter/premium");
    expect(content).toContain("Grok 4.6");
    expect(content).not.toContain("xai/grok-4.6");
    expect(content).not.toContain("opencode/grok-build-0.1");
    expect(content).not.toContain("opencode/claude-opus-4-8");
    expect(content).not.toContain("opencode/glm-5.2");
  });
});

describe("AGENTS.md Plans section grok tiers (MASTER-2033)", () => {
  test("Plans section contains `cheap` and `premium` and does not contain `Grok 4.6`; keep Opus 4.8 / GLM 5.2 absent", () => {
    const content = readText("AGENTS.md");

    // Pin the Plans intro to cheap/premium; Grok 4.6 gone; Opus/GLM stay absent.
    const plansSection = (content.match(/## Plans([\s\S]*?)(?=\n## |$)/) || ["", content])[1].toLowerCase();
    expect(plansSection).toContain("cheap");
    expect(plansSection).toContain("premium");
    expect(plansSection).not.toContain("grok 4.6");
    expect(plansSection).not.toContain("opus 4.8");
    expect(plansSection).not.toContain("glm 5.2");
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
