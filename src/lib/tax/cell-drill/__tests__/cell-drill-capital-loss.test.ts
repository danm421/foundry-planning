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
 *
 * `ctxOverride` lets a test swap in a `filingStatus` (e.g. MFS) without
 * disturbing the default `ctx` used by every other test in this file.
 */
function args(
  taxDetail: Record<string, unknown>,
  ctxOverride: CellDrillContext = ctx,
): IncomeCellDrillArgs {
  const year = {
    year: 2030,
    taxDetail: { capitalGains: 0, stCapitalGains: 0, bySource: {}, ...taxDetail },
  } as unknown as ProjectionYear;
  return { year, columnKey: "capitalGains", ctx: ctxOverride };
}

function allRows(p: ReturnType<typeof buildIncomeCellDrill>) {
  return p.groups.flatMap((g) => g.rows);
}

/**
 * i1 — the LT/ST Cap Gains cells render `taxResult.income.capitalGains` /
 * `.shortCapitalGains`, which are the §1222-NETTED figures (floored at 0 by
 * `calculate.ts`). The drill-down used to total the RAW SIGNED
 * `taxDetail.capitalGains`, so with any prior-year carryforward the modal
 * contradicted the cell the advisor clicked to open it.
 */
function argsWithTaxResult(
  taxDetail: Record<string, unknown>,
  income: Record<string, number>,
): IncomeCellDrillArgs {
  const year = {
    year: 2030,
    taxDetail: { capitalGains: 0, stCapitalGains: 0, bySource: {}, ...taxDetail },
    taxResult: { income: { capitalGains: 0, shortCapitalGains: 0, ...income } },
  } as unknown as ProjectionYear;
  return { year, columnKey: "capitalGains", ctx };
}

describe("i1 — the drill total matches the cell it opened from", () => {
  it("totals the NETTED gain, not the raw signed taxDetail figure", () => {
    // The feature's own target user: $50,000 of gains this year against a
    // $30,000 seeded Schedule D carryover. Cell shows $20,000.
    const props = buildIncomeCellDrill(
      argsWithTaxResult(
        {
          capitalGains: 50_000,
          bySource: { "sale:tx1": { type: "capital_gains", amount: 50_000 } },
        },
        { capitalGains: 20_000 },
      ),
    );
    expect(props.total).toBe(20_000);
  });

  it("emits a reconciling row so the itemization still adds up", () => {
    const props = buildIncomeCellDrill(
      argsWithTaxResult(
        {
          capitalGains: 50_000,
          bySource: { "sale:tx1": { type: "capital_gains", amount: 50_000 } },
          capitalLossCarryforward: { shortTerm: 0, longTerm: 0 },
        },
        { capitalGains: 20_000 },
      ),
    );
    const rows = allRows(props);
    const reconcile = rows.find((r) => r.id === "capital-loss-netting");
    expect(reconcile, "no reconciling row between the itemized rows and the total").toBeDefined();
    expect(reconcile!.amount).toBe(-30_000);
    // Itemized rows + the reconciling row === the total the modal displays.
    const itemized = props.groups[0].rows.reduce((s, r) => s + r.amount, 0);
    expect(itemized + reconcile!.amount).toBe(props.total);
  });

  it("adds no reconciling row when netting changed nothing", () => {
    const rows = allRows(
      buildIncomeCellDrill(
        argsWithTaxResult(
          {
            capitalGains: 50_000,
            bySource: { "sale:tx1": { type: "capital_gains", amount: 50_000 } },
          },
          { capitalGains: 50_000 },
        ),
      ),
    );
    expect(rows.some((r) => r.id === "capital-loss-netting")).toBe(false);
  });
});

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
    // Explicit zeros (not omitted fields) — this exercises the `> 0` guards
    // for real, rather than passing vacuously via `?? 0` / `cf === undefined`
    // defaults on fields that were never wired up.
    const rows = allRows(buildIncomeCellDrill(args({
      capitalGains: 50_000,
      capitalLossDeduction: 0,
      capitalLossCarryforward: { shortTerm: 0, longTerm: 0 },
      disallowedCapitalLoss: 0,
    })));
    expect(rows.some((r) => r.id.startsWith("capital-loss"))).toBe(false);
  });

  it("never claims a carryforward went un-offset — both tax modes now net", () => {
    // C1 removed the flat-mode caveat: `calculateTaxYearFlat` runs the same
    // §1222/§1211(b) netting as the bracket path, so `deduction === 0` while
    // the carryforward is nonzero is unreachable (a nonzero carryforward-out
    // requires shortTermLoss + longTermLoss > 0, which pins
    // deduction = min(that, limit) > 0). See netCapitalGainsAndLosses /
    // computeCarryforwardOut in ../../capital-loss.ts.
    const rows = allRows(buildIncomeCellDrill(args({
      capitalLossDeduction: 0,
      capitalLossCarryforward: { shortTerm: 0, longTerm: 50_000 },
    })));
    const row = rows.find((r) => r.id === "capital-loss-carryforward")!;
    expect(row.meta).not.toContain("No offset against ordinary income");
  });

  it("puts capital-loss rows in a separate labeled group with a footnote, not the flow-row total", () => {
    const props = buildIncomeCellDrill(args({
      capitalLossDeduction: 3_000,
      capitalLossCarryforward: { shortTerm: 0, longTerm: 77_000 },
    }));
    expect(props.groups).toHaveLength(2);
    expect(props.groups[0].label).toBeUndefined(); // the flow-row group is unlabeled, as before
    expect(props.groups[1].label).toBe("Capital Loss Carryover");
    expect(props.groups[1].rows.map((r) => r.id)).toEqual([
      "capital-loss-deduction",
      "capital-loss-carryforward",
    ]);
    expect(props.footnote).toBeTruthy();
    expect(props.footnote).toContain("sit outside it");
  });

  it("uses the $1,500 MFS limit in the deduction tooltip when filing status is married_separate", () => {
    const mfsCtx: CellDrillContext = { ...ctx, filingStatus: "married_separate" };
    const rows = allRows(buildIncomeCellDrill(args(
      { capitalLossDeduction: 1_500, capitalLossCarryforward: { shortTerm: 0, longTerm: 10_000 } },
      mfsCtx,
    )));
    const row = rows.find((r) => r.id === "capital-loss-deduction")!;
    expect(row.meta).toContain("$1,500");
    expect(row.meta).not.toContain("$3,000");
  });
});
