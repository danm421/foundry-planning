/**
 * Every `/admin` page and layout must call an ops-admin gate in its OWN body.
 *
 * The shared `src/app/admin/layout.tsx` is not sufficient. Next renders a page
 * without its parent layouts when the RSC request carries a
 * `Next-Router-State-Tree` claiming those segments are already on the client:
 * `next/dist/server/app-render/walk-tree-with-flight-router-state.js` only
 * invokes a segment's component inside `if (renderComponentsOnThisLevel)`, and
 * the header is trusted after a shape check. Next's own auth guide says the
 * same — "a layout does not control whether the rest of the route renders".
 *
 * A new admin page that forgets its gate is a cross-firm data leak (firm list,
 * customer emails, Stripe ids, billing), so this is a scan, not a sample.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const ADMIN_DIR = join(process.cwd(), "src/app/admin");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.name === "page.tsx" || e.name === "layout.tsx" ? [full] : [];
  });
}

describe("every /admin page gates itself", () => {
  const files = walk(ADMIN_DIR);

  it("finds the admin console's pages at all (guards against a moved directory)", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it.each(files.map((f) => [relative(process.cwd(), f), f]))(
    "%s calls requireOpsAdmin",
    (_label, file) => {
      // Comments are stripped first: `admin/page.tsx` mentions
      // `requireOpsAdmin("ops")` in a comment about a sibling page, and a scan
      // that counted that would pass while the page had no gate at all.
      const src = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      // `getOpsAdmin` deliberately does NOT count: it returns null instead of
      // refusing, and is used for nav filtering.
      expect(/\brequireOpsAdmin(Page)?\s*\(/.test(src)).toBe(true);
    },
  );
});
