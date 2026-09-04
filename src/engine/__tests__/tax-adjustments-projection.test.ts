import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type { TaxAdjustmentRow } from "../tax-adjustments";
import type { ClientData, ProjectionYear } from "../types";
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

  // `withheldMode: "percent"` has no end-to-end coverage otherwise. 22% of the
  // $100,000 row is the same $22,000 the "amount" row states outright, so the
  // two modes must produce an identical projection — a stronger assertion than
  // re-checking the number, since it also catches the percent arm being applied
  // to the wrong base.
  it("applies percent-mode withholding to the adjustment amount", () => {
    const pct: TaxAdjustmentRow = { ...bonus, withheldMode: "percent", withheldValue: 0.22 };
    const r = runProjection({ ...buildBaseClient(), taxAdjustments: [pct] });
    const asAmount = runProjection({ ...buildBaseClient(), taxAdjustments: [bonus] });

    expect(r[0].taxResult!.flow.taxAlreadyPaid).toBeCloseTo(22_000, 2);
    expect(r[0].expenses.taxes).toBeCloseTo(asAmount[0].expenses.taxes, 2);
    expect(r[0].expenses.bySource["tax_withheld_adjustments"]).toBeCloseTo(-22_000, 2);
  });

  // Covers the `if (taxAlreadyPaid > 0)` guard directly — only transitively
  // exercised otherwise. The key must be ABSENT, not present-and-zero: a `-0`
  // row would show up in the expense drill-down as a phantom line.
  it("writes no drill-down row when nothing was withheld", () => {
    const r = runProjection({ ...buildBaseClient(), taxAdjustments: [noWithhold] });
    expect(r[0].expenses.bySource).not.toHaveProperty("tax_withheld_adjustments");
    expect(r[0].taxResult!.flow.taxAlreadyPaid).toBe(0);
    expect(r[0].taxResult!.flow.balanceDue).toBeCloseTo(r[0].taxResult!.flow.totalTax, 2);
  });

  it("clamps at zero rather than producing a refund inflow", () => {
    const over: TaxAdjustmentRow = { ...bonus, withheldValue: 10_000_000 };
    const r = runProjection({ ...buildBaseClient(), taxAdjustments: [over] });
    expect(r[0].expenses.taxes).toBe(0);
    expect(r[0].taxResult!.flow.balanceDue).toBe(0);
    expect(r[0].taxResult!.flow.taxAlreadyPaid).toBeCloseTo(r[0].taxResult!.flow.totalTax, 2);
  });
});

// ---------------------------------------------------------------------------
// Task 4b — the FUNDING seam. Everything above this line checks what the plan
// REPORTS; these check what the plan actually withdraws. The base helper's cash
// account is not flagged `isDefaultChecking`, so it runs the legacy no-checking
// path where taxes never debit an account at all — that is why the reporting
// tests above could not have caught a double-withdrawal. `withChecking()` puts
// the same household on the real funding seam.
// ---------------------------------------------------------------------------
/** Cash that actually left household checking as tax, read off the ledger. */
const taxCashOut = (year: ProjectionYear, checkingId: string) =>
  (year.accountLedgers[checkingId]?.entries ?? [])
    .filter((e) => e.category === "tax")
    .reduce((sum, e) => sum - e.amount, 0);

describe("recorded withholding at the tax funding seam", () => {
  const withChecking = (): ClientData => {
    const base = buildBaseClient();
    return { ...base, accounts: [{ ...base.accounts[0], isDefaultChecking: true }] };
  };

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

  const run = (adj: TaxAdjustmentRow) =>
    runProjection({ ...withChecking(), taxAdjustments: [adj] })[0];

  it("leaves the withheld dollars in the portfolio instead of withdrawing them twice", () => {
    const a = run(noWithhold);
    const b = run(bonus);

    expect(b.portfolioAssets.liquidTotal - a.portfolioAssets.liquidTotal).toBeCloseTo(22_000, 2);
    // And the money that did move matches the line the cash flow reports.
    expect(taxCashOut(a, "acc-cash")).toBeCloseTo(a.expenses.taxes, 2);
    expect(taxCashOut(b, "acc-cash")).toBeCloseTo(b.expenses.taxes, 2);
    expect(taxCashOut(a, "acc-cash") - taxCashOut(b, "acc-cash")).toBeCloseTo(22_000, 2);
  });

  it("does not change the liability when it changes the funding", () => {
    const a = run(noWithhold);
    const b = run(bonus);
    expect(b.taxResult!.flow.totalTax).toBeCloseTo(a.taxResult!.flow.totalTax, 2);
    expect(b.taxResult!.flow.taxAlreadyPaid).toBeCloseTo(22_000, 2);
  });

  // Before this fix the cash-flow statement moved by the withheld amount while
  // the balance sheet did not move at all — the Solver shortfall column read one
  // and the balances read the other.
  it("moves netCashFlow and the ending balance by the same amount", () => {
    const a = run(noWithhold);
    const b = run(bonus);

    const cashFlowDelta =
      (b.totalIncome - b.totalExpenses) - (a.totalIncome - a.totalExpenses);
    const balanceDelta = b.portfolioAssets.liquidTotal - a.portfolioAssets.liquidTotal;

    expect(balanceDelta).toBeGreaterThan(0);
    expect(cashFlowDelta).toBeCloseTo(balanceDelta, 2);
    expect(b.netCashFlow - a.netCashFlow).toBeCloseTo(balanceDelta, 2);
  });

  // Over-withholding is a refund the plan cannot model as a cash inflow, so the
  // credit stops at the year's own tax. Without the clamp this $10M row would
  // hand the household $10M of phantom cash.
  it("clamps over-withholding — the plan can keep at most the year's tax", () => {
    const a = run(noWithhold);
    const over = run({ ...bonus, withheldValue: 10_000_000 });

    const delta = over.portfolioAssets.liquidTotal - a.portfolioAssets.liquidTotal;
    expect(delta).toBeCloseTo(a.taxResult!.flow.totalTax, 2);
    expect(taxCashOut(over, "acc-cash")).toBe(0);
    expect(over.expenses.taxes).toBe(0);
  });

  // 22% of the $100,000 row is the same $22,000 the "amount" row states, so the
  // two modes must fund identically — the clamp reads `taxAdj.alreadyPaid`,
  // which is mode-agnostic, and this proves the percent arm reaches it.
  it("funds a percent-mode row exactly like the equivalent amount row", () => {
    const pct = run({ ...bonus, withheldMode: "percent", withheldValue: 0.22 });
    const amt = run(bonus);
    expect(pct.portfolioAssets.liquidTotal).toBeCloseTo(amt.portfolioAssets.liquidTotal, 2);
    expect(taxCashOut(pct, "acc-cash")).toBeCloseTo(taxCashOut(amt, "acc-cash"), 2);
    // Parity alone would hold even if NEITHER row were netted, so pin the
    // absolute move as well.
    expect(
      pct.portfolioAssets.liquidTotal - run(noWithhold).portfolioAssets.liquidTotal,
    ).toBeCloseTo(22_000, 2);
  });
});

// The block above never enters the convergence loop (the household runs a large
// surplus, so it breaks on iteration 0). This one does: checking is too small to
// pay the bill, so the loop has to size an IRA draw — and that draw must be
// sized on the balance due, not the whole liability.
describe("recorded withholding inside the supplemental convergence loop", () => {
  const CLIENT_FM_ID = "00000000-0000-0000-0000-000000000001";
  const owner = [{ kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 } as const];
  const FLAT_RATE =
    buildBaseClient().planSettings.flatFederalRate! +
    buildBaseClient().planSettings.flatStateRate!;

  // Owner is 70, so no pre-59½ penalty muddies the arithmetic.
  const deficitPlan = (adj: TaxAdjustmentRow): ClientData => {
    const base = buildBaseClient();
    return {
      ...base,
      client: { ...base.client, dateOfBirth: "1956-01-01" },
      familyMembers: [{ ...base.familyMembers![0], dateOfBirth: "1956-01-01" }],
      accounts: [
        {
          id: "acc-checking",
          name: "Checking",
          category: "cash",
          subType: "checking",
          value: 10_000,
          basis: 10_000,
          growthRate: 0,
          rmdEnabled: false,
          isDefaultChecking: true,
          owners: owner,
        },
        {
          id: "acc-ira",
          name: "Trad IRA",
          category: "retirement",
          subType: "traditional_ira",
          value: 2_000_000,
          basis: 0,
          growthRate: 0,
          rmdEnabled: false,
          owners: owner,
        },
      ] as ClientData["accounts"],
      incomes: [],
      expenses: [
        {
          id: "exp-living",
          name: "Living",
          type: "living",
          annualAmount: 100_000,
          growthRate: 0,
          startYear: 2026,
          endYear: 2026,
        },
      ] as ClientData["expenses"],
      withdrawalStrategy: [
        { accountId: "acc-ira", priorityOrder: 1, startYear: 2026, endYear: 2026 },
      ],
      planSettings: { ...base.planSettings, taxEngineMode: "flat", planEndYear: 2026 },
      taxAdjustments: [adj],
    };
  };

  const k1: TaxAdjustmentRow = {
    id: "adj-k1",
    taxType: "ordinary_income",
    name: "K-1, tax paid at the entity",
    annualAmount: 50_000,
    growthRate: 0,
    startYear: 2026,
    endYear: 2026,
    withheldMode: "amount",
    withheldValue: 15_000,
  };
  const noWithhold: TaxAdjustmentRow = { ...k1, withheldMode: "none", withheldValue: 0 };

  it("sizes the IRA draw on the balance due, not the whole liability", () => {
    const a = runProjection(deficitPlan(noWithhold))[0];
    const b = runProjection(deficitPlan(k1))[0];

    const drawA = a.withdrawals.byAccount["acc-ira"] ?? 0;
    const drawB = b.withdrawals.byAccount["acc-ira"] ?? 0;
    expect(drawA).toBeGreaterThan(0);

    // Each dollar of draw is taxed, so $15,000 of relieved tax shrinks the draw
    // by 15,000 / (1 − 0.30) — the same gross-up the loop's Newton step applies.
    expect(drawA - drawB).toBeCloseTo(15_000 / (1 - FLAT_RATE), 0);
    expect(b.portfolioAssets.liquidTotal - a.portfolioAssets.liquidTotal).toBeCloseTo(
      15_000 / (1 - FLAT_RATE),
      0,
    );
  });

  it("still converges: checking lands at zero and the cash tax matches the report", () => {
    for (const adj of [noWithhold, k1]) {
      const year = runProjection(deficitPlan(adj))[0];
      expect(year.portfolioAssets.cash["acc-checking"] ?? 0).toBeCloseTo(0, 0);
      expect(taxCashOut(year, "acc-checking")).toBeCloseTo(year.expenses.taxes, 2);
      // No `engine_iteration_limit` residual — the loop still reaches its fixed point.
      expect(year.trustWarnings ?? []).toEqual([]);
    }
  });
});
