import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type { TaxAdjustmentRow } from "../tax-adjustments";
import { buildBaseClient } from "./_helpers/tax-adjustments-fixture";

// NB: `runProjection` returns `ProjectionYear[]` directly (there is no `.years`
// wrapper — that shape belongs to `runProjectionWithEvents`), so year 0 is `[0]`.

const conversion: TaxAdjustmentRow = {
  id: "adj-roth",
  taxType: "ordinary_income",
  name: "Roth conversion completed in March",
  annualAmount: 120_000,
  growthRate: 0,
  startYear: 2026,
  endYear: 2026,
  withheldMode: "none",
  withheldValue: 0,
};

describe("tax adjustments in the projection", () => {
  it("raises taxable income without moving any cash", () => {
    const base = runProjection(buildBaseClient());
    const withAdj = runProjection({ ...buildBaseClient(), taxAdjustments: [conversion] });

    const b = base[0];
    const w = withAdj[0];

    expect(w.taxDetail!.ordinaryIncome - b.taxDetail!.ordinaryIncome).toBeCloseTo(120_000, 2);
    expect(w.taxResult!.flow.totalTax).toBeGreaterThan(b.taxResult!.flow.totalTax);
    // The whole point: no cash moved.
    expect(w.income.total).toBeCloseTo(b.income.total, 2);
  });

  it("names the adjustment in the drill-down", () => {
    const r = runProjection({ ...buildBaseClient(), taxAdjustments: [conversion] });
    expect(r[0].taxDetail!.bySource["tax_adjustment:adj-roth"]).toEqual({
      type: "ordinary_income",
      amount: 120_000,
    });
  });

  // Distinct amounts per bucket on purpose: equal ones would let a copy-paste
  // swap between two lines pass.
  it("routes each tax type to its own taxDetail bucket", () => {
    const types = [
      "earned_income",
      "ordinary_income",
      "dividends",
      "capital_gains",
      "stcg",
      "qbi",
      "tax_exempt",
    ] as const;
    const rows: TaxAdjustmentRow[] = types.map((taxType, i) => ({
      ...conversion,
      id: `adj-${taxType}`,
      taxType,
      annualAmount: 10_000 * (i + 1),
    }));
    const b = runProjection(buildBaseClient())[0].taxDetail!;
    const w = runProjection({ ...buildBaseClient(), taxAdjustments: rows })[0].taxDetail!;

    expect(w.earnedIncome - b.earnedIncome).toBeCloseTo(10_000, 2);
    expect(w.ordinaryIncome - b.ordinaryIncome).toBeCloseTo(20_000, 2);
    expect(w.dividends - b.dividends).toBeCloseTo(30_000, 2);
    expect(w.capitalGains - b.capitalGains).toBeCloseTo(40_000, 2);
    expect(w.stCapitalGains - b.stCapitalGains).toBeCloseTo(50_000, 2);
    expect(w.qbi - b.qbi).toBeCloseTo(60_000, 2);
    expect(w.taxExempt - b.taxExempt).toBeCloseTo(70_000, 2);
    // `tax_exempt` must NOT touch `taxExemptInterest` — that field is the
    // muni-interest subset feeding IRMAA MAGI, and an adjustment is not
    // necessarily muni interest.
    expect(w.taxExemptInterest).toBe(b.taxExemptInterest);
  });

  // THE flat-vs-bracket guard. A capital-gains adjustment folded into
  // `taxableIncome` but not into `capitalGainsInTaxableIncome` is invisible in
  // bracket mode and wrong in flat mode only — this is the test that catches it.
  it("keeps a capital-gains adjustment in lockstep in flat mode", () => {
    const gain: TaxAdjustmentRow = { ...conversion, id: "adj-cg", taxType: "capital_gains" };
    const flatBase = buildBaseClient({ taxEngineMode: "flat" });
    const base = runProjection(flatBase);
    const withAdj = runProjection({ ...flatBase, taxAdjustments: [gain] });
    const delta = withAdj[0].taxResult!.flow.totalTax - base[0].taxResult!.flow.totalTax;
    const flatRate =
      Number(flatBase.planSettings.flatFederalRate) + Number(flatBase.planSettings.flatStateRate);
    expect(delta).toBeCloseTo(120_000 * flatRate, 2);

    // `totalTax` on its own CANNOT see a lockstep break. With no loss and no
    // carryforward, §1222 netting is the identity, so flat mode subtracts the
    // long-term figure and adds the very same number straight back — the two
    // cancel and the total is blind to it. The netted classification is where
    // it shows: drop `taxAdj.capitalGainsLt` from the pair and this $120K
    // reappears as ordinary income.
    const b = base[0].taxResult!.income;
    const w = withAdj[0].taxResult!.income;
    expect(w.capitalGains - b.capitalGains).toBeCloseTo(120_000, 2);
    expect(w.ordinaryIncome - b.ordinaryIncome).toBeCloseTo(0, 2);
  });

  // Same guard for the other arm of the pair.
  it("keeps a short-term adjustment on the short-term arm in flat mode", () => {
    const stcg: TaxAdjustmentRow = { ...conversion, id: "adj-stcg", taxType: "stcg" };
    const flatBase = buildBaseClient({ taxEngineMode: "flat" });
    const b = runProjection(flatBase)[0].taxResult!.income;
    const w = runProjection({ ...flatBase, taxAdjustments: [stcg] })[0].taxResult!.income;
    expect(w.shortCapitalGains - b.shortCapitalGains).toBeCloseTo(120_000, 2);
  });

  it("is byte-identical to today when there are no adjustments", () => {
    const a = runProjection(buildBaseClient());
    const b = runProjection({ ...buildBaseClient(), taxAdjustments: [] });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe("withholding recorded on an adjustment", () => {
  const bonus: TaxAdjustmentRow = {
    id: "adj-bonus",
    taxType: "earned_income",
    name: "Q1 bonus, already banked",
    annualAmount: 100_000,
    growthRate: 0,
    startYear: 2026,
    endYear: 2026,
    withheldMode: "amount",
    withheldValue: 22_000,
  };
  const noWithhold: TaxAdjustmentRow = { ...bonus, withheldMode: "none", withheldValue: 0 };

  it("reduces the cash-flow tax line but never the reported liability", () => {
    const a = runProjection({ ...buildBaseClient(), taxAdjustments: [noWithhold] });
    const b = runProjection({ ...buildBaseClient(), taxAdjustments: [bonus] });

    // Liability is identical — withholding is a payment, not a deduction.
    expect(b[0].taxResult!.flow.totalTax).toBeCloseTo(a[0].taxResult!.flow.totalTax, 2);
    // Cash paid drops by exactly the withheld amount.
    expect(a[0].expenses.taxes - b[0].expenses.taxes).toBeCloseTo(22_000, 2);
    expect(b[0].taxResult!.flow.taxAlreadyPaid).toBeCloseTo(22_000, 2);
    expect(b[0].taxResult!.flow.balanceDue).toBeCloseTo(
      b[0].taxResult!.flow.totalTax - 22_000,
      2,
    );
  });

  // `expenses.total` is summed INSIDE the same object literal, and one of its
  // terms is the raw `totalTaxes`. Netting `expenses.taxes` alone leaves the
  // total overstated and disagreeing with its own tax line — a bug that ships
  // green without this test.
  it("nets the withheld amount out of expenses.total too", () => {
    const a = runProjection({ ...buildBaseClient(), taxAdjustments: [noWithhold] });
    const b = runProjection({ ...buildBaseClient(), taxAdjustments: [bonus] });

    expect(a[0].expenses.total - b[0].expenses.total).toBeCloseTo(22_000, 2);
    // And the total still agrees with the netted line it is built from.
    expect(a[0].expenses.total - a[0].expenses.taxes).toBeCloseTo(
      b[0].expenses.total - b[0].expenses.taxes,
      2,
    );
  });

  it("reconciles in the expense drill-down", () => {
    const r = runProjection({ ...buildBaseClient(), taxAdjustments: [bonus] });
    expect(r[0].expenses.bySource["tax_withheld_adjustments"]).toBeCloseTo(-22_000, 2);
  });

  it("clamps at zero rather than producing a refund inflow", () => {
    const over: TaxAdjustmentRow = { ...bonus, withheldValue: 10_000_000 };
    const r = runProjection({ ...buildBaseClient(), taxAdjustments: [over] });
    expect(r[0].expenses.taxes).toBe(0);
    expect(r[0].taxResult!.flow.balanceDue).toBe(0);
    expect(r[0].taxResult!.flow.taxAlreadyPaid).toBeCloseTo(r[0].taxResult!.flow.totalTax, 2);
  });
});
