import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 0040 added `gifts_amount_positive CHECK (amount > 0)` by hand, so it is in no
// drizzle snapshot and no unit test can see it. A one-time Full RMD QCD stores
// amount 0 (the RMD sets the real figure), which that check refused with a 500.
// 0279 relaxes it for exactly that row. The live proof is a write against the
// dev database; this pins the migration text.
const statements = readFileSync(join(process.cwd(), "src/db/migrations/0279_qcd_gifts.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim());

const ADD = /^ALTER TABLE "gifts" ADD CONSTRAINT "gifts_amount_positive" CHECK \((.*)\);$/s;

describe("migration 0279 — gifts_amount_positive", () => {
  it("drops 0040's check, then re-adds it under the same name", () => {
    const drop = statements.indexOf('ALTER TABLE "gifts" DROP CONSTRAINT "gifts_amount_positive";');
    const add = statements.findIndex((s) => ADD.test(s));
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(add).toBeGreaterThan(drop);
  });

  it("allows amount 0 only for a Full RMD QCD", () => {
    const predicate = statements.map((s) => ADD.exec(s)?.[1]).find(Boolean) ?? "";
    expect(predicate.replace(/\s+/g, " ")).toBe(
      `"amount" > 0 OR ("amount" = 0 AND "qcd_amount_mode" IS NOT NULL AND "qcd_amount_mode" = 'full_rmd')`,
    );
    // The bare `amount > 0 OR qcd_amount_mode = 'full_rmd'` would let a $0 cash
    // gift through: its NULL mode makes the predicate NULL, and a CHECK passes
    // on NULL.
    expect(predicate).not.toMatch(/OR\s*\(?\s*"?qcd_amount_mode"?\s*=\s*'full_rmd'\s*\)?\s*$/);
  });
});
