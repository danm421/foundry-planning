import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Keep apps isolated: apps/web MUST NOT import from apps/admin (created in Plan 2)
// and MUST go through @foundry/* package names, not relative paths into packages/.
const WEB_ROOT = join(process.cwd(), "src");
const FORBIDDEN = [
  /from ["']\.\.\/\.\.\/\.\.\/packages\//,
  /from ["']@\/\.\.\/packages\//,
  /from ["']apps\/admin\//,
  /from ["']\.\.\/\.\.\/\.\.\/apps\//,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("package boundaries", () => {
  it("no web file reaches across app or package boundaries", () => {
    const offenders: string[] = [];
    for (const file of walk(WEB_ROOT)) {
      const src = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN) {
        if (pattern.test(src)) {
          offenders.push(`${file} matched ${pattern}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
