import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

describe("firstAgentContract is not a runtime authority", () => {
  it("is imported nowhere under app/ or lib/ except lib/agent/contract.ts", () => {
    const offenders = [...sourceFiles(join(root, "app")), ...sourceFiles(join(root, "lib"))]
      .filter((f) => !f.endsWith(join("lib", "agent", "contract.ts")))
      .filter((f) => /\bfirstAgentContract\b/.test(readFileSync(f, "utf8")))
      // This repo runs on Windows, where join produces backslashes.
      .map((f) => f.slice(root.length + 1).split("\\").join("/"));
    expect(offenders).toEqual([]);
  });
});
