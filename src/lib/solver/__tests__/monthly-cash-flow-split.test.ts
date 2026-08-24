import { describe, it, expect } from "vitest";
import { runProjection } from "@/engine/projection";
import { buildClientData, basePlanSettings, sampleAccounts } from "@/engine/__tests__/fixtures";
import { LEGACY_FM_CLIENT } from "@/engine/ownership";
import { buildMonthlyCashFlowRows } from "../monthly-cash-flow";
import type { Account, ClientData } from "@/engine/types";

/**
 * `sampleAccounts` has no `isDefaultChecking` account, and without one the
 * engine skips the ENTIRE surplus phase (`if (hasChecking)`, projection.ts:7095)
 * — discretionary spend, both `surplus_transfer` legs, `surplus_retained`, and
 * the absorb lever's `expenses.living +=`. Run these fixtures without it and
 * every split figure is 0: the reconciliation below "passes" while measuring an
 * inert code path. Shape copied from
 * `src/engine/__tests__/projection-surplus-allocation.test.ts`.
 */
const defaultChecking: Account = {
  id: "acct-checking",
  name: "Joint Checking",
  category: "cash",
  subType: "checking",
  titlingType: "jtwros",
  value: 10_000,
  basis: 10_000,
  growthRate: 0,
  rmdEnabled: false,
  isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const accountsWithChecking: Account[] = [defaultChecking, ...sampleAccounts];

/**
 * Annual dollars of residual we tolerate in `unexplained`, and why it is not
 * zero. In the one year the checking cushion runs dry, the engine's shortfall
 * gap-fill covers a hair less than the shortfall — measured in the "retained"
 * fixture at 2041: shortfall 140,245.60, covered 140,242.31, leaving checking at
 * −3.29 — and hands the same amount back the next year. That $3.29 on a
 * ~$190k/yr plan is the largest residual across all four fixtures here.
 *
 * A genuinely misfiled or dropped bucket is three orders of magnitude larger —
 * zeroing `fixed.savings` alone moves it by $23,500/yr — so this threshold
 * separates engine noise from a real defect without blunting the assertion.
 */
const RESIDUAL_TOLERANCE_PER_YEAR = 10;

/** Reconciles the available figure against a source it was NOT computed from.
 *  Left side: aggregate year fields (income, fixed costs, draw).
 *  Right side: per-account ledger entries plus the two expense aggregates.
 *
 *  What it catches: money entering or leaving the split — a dropped fixed cost,
 *  a `surplus_transfer` summed across both legs instead of one, an aggregate
 *  read off the wrong engine field.
 *
 *  What it CANNOT catch, measured rather than assumed: a fold BETWEEN two named
 *  parts. Folding `discretionary` into `living` leaves the sum identical and
 *  every call to this helper stays green. The per-bucket assertions in the four
 *  tests below are what pin each part to its own engine source — that fold reds
 *  only on "spend 100% of surplus". */
function expectSplitReconciles(clientData: ClientData) {
  // Vacuity guard: see `defaultChecking` above. A fixture without one measures
  // nothing, so fail loudly here rather than reconciling four zeroes.
  expect(clientData.accounts.some((a) => a.isDefaultChecking)).toBe(true);

  const years = runProjection(clientData);
  const rows = buildMonthlyCashFlowRows(years, clientData, "nominal");
  for (const r of rows) {
    const parts = r.split.living + r.split.surplusSpent + r.split.surplusUnspent;
    // Documents the relationship only — `unexplained` is COMPUTED as this
    // difference, so this line can never fail. The next one is the real test.
    expect(r.split.unexplained).toBeCloseTo(r.available - parts, 6);
    // The fixture plans have no asset transactions and no expense-reduction
    // savings, so nothing legitimate should land in `unexplained`.
    expect(Math.abs(r.split.unexplained * 12)).toBeLessThan(RESIDUAL_TOLERANCE_PER_YEAR);
  }
  return { rows, years };
}

describe("available splits into living / surplus spent / surplus unspent", () => {
  it("absorb lever on: the whole leftover lands in living expenses", () => {
    const clientData = buildClientData({
      accounts: accountsWithChecking,
      expenses: [
        {
          id: "exp-living",
          type: "living",
          name: "Living Expenses",
          annualAmount: 80_000,
          startYear: 2026,
          endYear: 2055,
          growthRate: 0.03,
          absorbsRemainingCashFlow: true,
        },
      ],
    });
    const { rows } = expectSplitReconciles(clientData);
    // The lever actually fired: 2026's living is the 80k schedule PLUS the
    // leftover (projection.ts:7142). Without the top-up it would be exactly 80k.
    expect(rows[0].year).toBe(2026);
    expect(rows[0].split.living * 12).toBeGreaterThan(80_000);
    for (const r of rows) {
      expect(r.split.surplusSpent).toBe(0);
      expect(r.split.surplusUnspent).toBe(0);
      // Same engine gap-fill residual as the reconciliation above, same reason.
      expect(Math.abs((r.split.living - r.available) * 12)).toBeLessThan(
        RESIDUAL_TOLERANCE_PER_YEAR,
      );
    }
  });

  it("spend 100% of surplus: available is living plus discretionary, nothing retained", () => {
    const clientData = buildClientData({
      accounts: accountsWithChecking,
      planSettings: { ...basePlanSettings, surplusSpendPct: 1 },
    });
    const { rows } = expectSplitReconciles(clientData);
    expect(rows.some((r) => r.split.surplusSpent > 0)).toBe(true);
    for (const r of rows) expect(r.split.surplusUnspent).toBe(0);
  });

  it("save 100% of surplus to a named account: the transfer leg is counted exactly once", () => {
    const clientData = buildClientData({
      accounts: accountsWithChecking,
      planSettings: {
        ...basePlanSettings,
        surplusSpendPct: 0,
        surplusSaveAccountId: "acct-brokerage",
      },
    });
    const { rows, years } = expectSplitReconciles(clientData);
    // Fixture-liveness guard: the engine quietly falls back to `surplus_retained`
    // when the destination is unusable, and this test would then pass while
    // being a duplicate of the one below. Pin that the TRANSFER path really ran.
    const transferredIn = years.some((y) =>
      (y.accountLedgers["acct-brokerage"]?.entries ?? []).some(
        (e) => e.category === "surplus_transfer" && e.amount > 0,
      ),
    );
    expect(transferredIn).toBe(true);
    // The regression this guards: surplus_transfer has an out-leg and an
    // in-leg. Summing both nets to zero and this goes silently to 0.
    expect(rows.some((r) => r.split.surplusUnspent > 0)).toBe(true);
    for (const r of rows) expect(r.split.surplusSpent).toBe(0);
  });

  it("save 100% of surplus with no destination: it is retained in checking and still counted", () => {
    const clientData = buildClientData({
      accounts: accountsWithChecking,
      planSettings: { ...basePlanSettings, surplusSpendPct: 0, surplusSaveAccountId: null },
    });
    const { rows } = expectSplitReconciles(clientData);
    expect(rows.some((r) => r.split.surplusUnspent > 0)).toBe(true);
  });
});
