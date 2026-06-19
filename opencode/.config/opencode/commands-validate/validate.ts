import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface CommandIssue {
  file: string;
  problem: string;
}

export function validateCommand(fileName: string, content: string): CommandIssue[] {
  const issues: CommandIssue[] = [];
  if (!/^bam-[a-z0-9]+(-[a-z0-9]+)*\.md$/.test(fileName)) {
    issues.push({ file: fileName, problem: "filename must match ^bam-[a-z0-9]+(-[a-z0-9]+)*\\.md$" });
  }

  const fmMatch = content.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/);
  if (!fmMatch) {
    issues.push({ file: fileName, problem: "missing or unparseable frontmatter" });
    return issues;
  }

  const fmBlock = fmMatch[1];
  const frontmatter: Record<string, string> = {};
  let parseOk = true;
  for (const line of fmBlock.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) {
      parseOk = false;
      break;
    }
    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    if (key) frontmatter[key] = value;
  }

  if (!parseOk) {
    issues.push({ file: fileName, problem: "frontmatter is unparseable" });
  }

  const desc = frontmatter.description;
  const fmEnd = fmMatch[0].length;
  const body = content.slice(fmEnd).trim();
  const model = frontmatter.model;
  const agent = frontmatter.agent;

  const checks = [
    { cond: !desc || desc.trim() === "", problem: "missing or empty description" },
    { cond: !body, problem: "missing or empty body" },
    { cond: model !== undefined && !model.includes("/"), problem: "model must contain '/' (provider/model-id)" },
    { cond: agent !== undefined && !["build", "plan", "general", "explore"].includes(agent), problem: "agent must be one of build, plan, general, explore" },
  ];
  for (const c of checks) {
    if (c.cond) {
      issues.push({ file: fileName, problem: c.problem });
    }
  }

  return issues;
}

export function validateAll(dir: string): CommandIssue[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    // Surface an explicit issue rather than returning [] — a silent empty
    // result would let a run pointed at the wrong/missing directory falsely
    // "pass" with no issues.
    const message = err instanceof Error ? err.message : String(err);
    return [{ file: dir, problem: `cannot read commands directory: ${message}` }];
  }
  const issues: CommandIssue[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const content = readFileSync(join(dir, entry), "utf8");
    const fileIssues = validateCommand(entry, content);
    issues.push(...fileIssues);
  }
  return issues;
}

