import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Multi-tenant isolation contract test.
 *
 * We don't (yet) have a full HTTP integration harness that can stand up
 * Clerk + Postgres for two distinct firms and prove firm-A → firm-B
 * returns 404. Instead this test enforces the structural invariant that
 * every mutating handler under `/api/clients/[id]/**` either:
 *
 *   (a) reads `firmId` from `getOrgId()`/`requireOrgId()` and uses it in
 *       a query before mutating, or
 *   (b) is explicitly opted out via an `@allow-firm-scope-exception`
 *       comment that documents why.
 *
 * Catches the C1-style regression where a new route forgets to scope to
 * the caller's firm. Grepping the text is coarse but cheap and makes
 * the invariant visible to auditors.
 *
 * A full two-firm HTTP test is tracked in FUTURE_WORK.md.
 */

const API_ROOT = join(process.cwd(), "src/app/api/clients");
const CMA_ROOT = join(process.cwd(), "src/app/api/cma");
// These endpoints don't touch tenant-owned data or are read-only listing
// of firm-scoped-by-default data and are OK to skip.
const EXPLICIT_ALLOWLIST = new Set<string>([
  // (none right now — add with justification)
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, out);
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

describe("tenant isolation contract", () => {
  const routes = [...walk(API_ROOT), ...walk(CMA_ROOT)];

  it("discovers route files", () => {
    // Sanity: if this drops to zero the walker broke, not the audit.
    expect(routes.length).toBeGreaterThan(10);
  });

  it.each(routes)("%s derives firmId from Clerk before mutating", (file) => {
    const rel = file.replace(process.cwd() + "/", "");
    if (EXPLICIT_ALLOWLIST.has(rel)) return;

    const src = readFileSync(file, "utf8");
    const hasMutation = /\bdb\s*\.\s*(update|delete|insert)\b/.test(src);
    if (!hasMutation) return; // read-only, skip

    const derivesFirmId = /\b(getOrgId|requireOrgId)\s*\(/.test(src);
    const hasEscapeHatch = /@allow-firm-scope-exception/.test(src);

    if (!derivesFirmId && !hasEscapeHatch) {
      throw new Error(
        `${rel}: mutating handler does not call getOrgId() / requireOrgId() — ` +
          `add the call, or document the exception with an ` +
          `@allow-firm-scope-exception comment.`
      );
    }
  });

  it.each(routes)("%s force-dynamic directive present", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).toMatch(/export const dynamic\s*=\s*["']force-dynamic["']/);
  });
});
