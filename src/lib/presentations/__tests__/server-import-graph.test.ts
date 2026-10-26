import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";

/**
 * Every presentation page's data is built on the server (the runs and
 * export-pdf routes). A module marked "use client" imports there as a client
 * reference — calling one of its functions throws "Attempted to call X() from
 * the server". Vitest ignores the directive, so only this static walk sees it:
 * nothing under src/lib/presentations may reach a "use client" module through
 * a value import in src/lib or src/engine, however many files away.
 *
 * The walk does not descend into src/components: the page registry imports
 * each page's "use client" options control on purpose, and those only render
 * in the browser.
 */

const SRC = path.resolve(__dirname, "../../..");
const ROOT = path.join(SRC, "lib/presentations");
const COMPONENTS = path.join(SRC, "components");

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "__tests__") walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? path.join(SRC, spec.slice(2))
    : spec.startsWith(".")
      ? path.resolve(path.dirname(from), spec)
      : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

// `import type` / `export type` are erased at build time, so they never cross.
const VALUE_IMPORT = /^(?:import|export)\s+(?!type\s)(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/gm;

function isClientModule(source: string): boolean {
  const body = source.replace(/^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/, "");
  return /^["']use client["']/.test(body);
}

describe("presentations server import graph", () => {
  it("never reaches a \"use client\" module", () => {
    const offenders: string[] = [];
    const seen = new Set<string>();
    const queue = walk(ROOT, []).map((file) => ({ file, chain: [file] }));

    while (queue.length > 0) {
      const { file, chain } = queue.shift()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      if (isClientModule(source)) {
        offenders.push(chain.map((f) => path.relative(SRC, f)).join(" -> "));
        continue;
      }
      if (file.startsWith(COMPONENTS)) continue;
      for (const match of source.matchAll(VALUE_IMPORT)) {
        const target = resolveImport(file, match[1]);
        if (target && !seen.has(target)) queue.push({ file: target, chain: [...chain, target] });
      }
    }

    expect(offenders).toEqual([]);
  });
});
