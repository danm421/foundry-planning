import { describe, it, expect } from "vitest";
import type { ProjectionYear } from "@/engine/types";
import { buildIncomeCellDrill } from "../income-breakdown";
import type { CellDrillContext, IncomeCellDrillArgs } from "../types";

const ctx: CellDrillContext = { accountNames: {}, incomes: [], accounts: [] };

/**
 * Builds a real `IncomeCellDrillArgs` with only the `taxDetail` slice this
 * feature reads populated. `ProjectionYear` carries ~40 fields unrelated to
 * this test (withdrawals, entityCashFlow, portfolioAssets, accountLedgers,
 * ...), so building one in full is impractical — the sibling
 * `income-breakdown.test.ts` in this same directory casts for the same
 * reason. Only `year` is cast; `ctx` and `columnKey` are real, fully-typed
 * values, narrower than the brief's whole-args cast.
 */
function args(taxDetail: Record<string, unknown>): IncomeCellDrillArgs {
  const year = {
    year: 2030,
    taxDetail: { capitalGains: 0, stCapitalGains: 0, bySource: {}, ...taxDetail },
  } as unknown as ProjectionYear;
  return { year, columnKey: "capitalGains", ctx };
}

function allRows(p: ReturnType<typeof buildIncomeCellDrill>) {
  return p.groups.flatMap((g) => g.rows);
}

describe("capital-loss rows in the income drill-down", () => {
  it("shows the capped deduction and the amount carried forward", () => {
    const rows = allRows(buildIncomeCellDrill(args({
      capitalLossDeduction: 3_000,
      capitalLossCarryforward: { shortTerm: 0, longTerm: 77_000 },
    })));
    const row = rows.find((r) => r.id === "capital-loss-deduction")!;
    expect(row.amount).toBe(-3_000);
    expect(row.meta).toContain("$3,000");
  });

  it("shows the end-of-year carryforward balance", () => {
    const rows = allRows(buildIncomeCellDrill(args({
      capitalLossDeduction: 3_000,
      capitalLossCarryforward: { shortTerm: 1_000, longTerm: 77_000 },
    })));
    const row = rows.find((r) => r.id === "capital-loss-carryforward")!;
    expect(row.amount).toBe(78_000);
    expect(row.meta).toContain("long-term");
  });

  it("reports a disallowed personal-residence loss without deducting it", () => {
    const rows = allRows(buildIncomeCellDrill(args({
      capitalLossDeduction: 0,
      disallowedCapitalLoss: 40_000,
    })));
    const row = rows.find((r) => r.id === "capital-loss-disallowed")!;
    expect(row.amount).toBe(0);
    expect(row.meta).toContain("personal residence");
  });

  it("adds no rows when there is no loss activity", () => {
    const rows = allRows(buildIncomeCellDrill(args({ capitalGains: 50_000 })));
    expect(rows.some((r) => r.id.startsWith("capital-loss"))).toBe(false);
  });
});
