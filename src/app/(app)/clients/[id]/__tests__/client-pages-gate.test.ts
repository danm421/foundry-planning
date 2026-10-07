/**
 * Every client workspace page and nested layout must check client access in
 * its OWN body.
 *
 * The parent `clients/[id]/layout.tsx` check is not sufficient. Next renders a
 * page without its parent layouts when the RSC request carries a
 * `Next-Router-State-Tree` claiming those segments are already on the client
 * (`next/dist/server/app-render/walk-tree-with-flight-router-state.js` only
 * invokes a segment's component inside `if (renderComponentsOnThisLevel)`),
 * and the header is trusted after a shape check. A firm-only predicate is not
 * the check either: it skips the advisor book, the Private rule and shares.
 * Same rule and same kind of scan as `src/app/admin/__tests__/admin-pages-gate`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const CLIENT_DIR = join(process.cwd(), "src/app/(app)/clients/[id]");

// Files that load nothing: pure redirects and presentational wrappers. Each
// must stay import-free of the database and of `@/lib` — the moment one starts
// loading data it needs a gate, and the check below fails.
const LOADS_NOTHING = new Set([
  "page.tsx",
  "assets/page.tsx",
  "balance-sheet/page.tsx",
  "income-expenses/page.tsx",
  "settings/page.tsx",
  "client-data/page.tsx",
  "client-data/[...slug]/page.tsx",
  "details/balance-sheet/page.tsx",
  "details/deductions/page.tsx",
  "details/plan-vs-return/page.tsx",
  "estate-planning/page.tsx",
  "cashflow/ledgers/page.tsx",
  "cashflow/ledgers/layout.tsx",
  "onboarding/layout.tsx",
]);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return ["page.tsx", "layout.tsx"].includes(e.name) ? [full] : [];
  });
}

function code(file: string): string {
  // Comments are stripped so a gate named in a comment does not count.
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const files = walk(CLIENT_DIR).map((f) => ({ file: f, rel: relative(CLIENT_DIR, f) }));

describe("every client workspace page gates itself", () => {
  it("finds the client workspace's pages at all (guards against a moved directory)", () => {
    expect(files.length).toBeGreaterThanOrEqual(50);
  });

  it.each(files.filter((f) => !LOADS_NOTHING.has(f.rel)).map((f) => [f.rel, f.file]))(
    "%s checks client access",
    (_rel, file) => {
      expect(/\b(requireClientPageAccess|requireClientAccess)\s*\(/.test(code(file))).toBe(true);
    },
  );

  it.each(files.filter((f) => LOADS_NOTHING.has(f.rel)).map((f) => [f.rel, f.file]))(
    "%s loads nothing, so it needs no gate",
    (_rel, file) => {
      expect(code(file)).not.toMatch(/from\s+["']@\/(db|lib)\b/);
    },
  );
});
