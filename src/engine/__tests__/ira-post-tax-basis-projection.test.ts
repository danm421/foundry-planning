import { describe, it, expect } from "vitest";
import { runProjection } from "..";
import { buildClientData, baseClient, sampleFamilyMembers } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, ClientData } from "../types";

const checking: Account = {
  id: "acct-checking",
  name: "Household Checking",
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

/** One Traditional IRA, flat growth, drawn down by a fixed living expense. */
function build(iraBasis: number): ClientData {
  const ira: Account = {
    id: "acct-ira",
    name: "Traditional IRA",
    category: "retirement",
    subType: "traditional_ira",
    titlingType: "jtwros",
    value: 400_000,
    basis: iraBasis,
    growthRate: 0,
    rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  };

  return buildClientData({
    client: {
      ...baseClient,
      dateOfBirth: "1950-03-01", // past 59.5 (no penalty), pre-RMD-age noise
      filingStatus: "single",
      spouseName: undefined,
      spouseDob: undefined,
      spouseRetirementAge: undefined,
      retirementAge: 60,
    },
    familyMembers: [{ ...sampleFamilyMembers[0], dateOfBirth: "1950-03-01" }],
    accounts: [ira, checking],
    incomes: [],
    expenses: [
      {
        id: "exp-living",
        type: "living",
        name: "Living Expenses",
        annualAmount: 40_000,
        startYear: 2026,
        endYear: 2045,
        growthRate: 0,
      },
    ],
    savingsRules: [],
    liabilities: [],
    withdrawalStrategy: [
      { accountId: "acct-ira", priorityOrder: 1, startYear: 2026, endYear: 2100 },
    ],
  });
}

describe("Traditional IRA post-tax basis — end to end", () => {
  it("taxes only 75% of the draw when the IRA is 25% post-tax basis", () => {
    const withBasis = runProjection(build(100_000));
    const noBasis = runProjection(build(0));

    const oi = (y: (typeof withBasis)[number]) => y.taxDetail?.ordinaryIncome ?? 0;
    // Cash is drawn alongside the IRA, so measure the IRA leg specifically.
    const iraDraw = (y: (typeof withBasis)[number]) => y.withdrawals?.byAccount["acct-ira"] ?? 0;

    expect(iraDraw(withBasis[0])).toBeGreaterThan(0);
    // 100k basis / 400k pool ⇒ 25% of the IRA draw comes back tax-free.
    expect(oi(withBasis[0])).toBeCloseTo(iraDraw(withBasis[0]) * 0.75, 0);
    // Same plan with no basis: every dollar of the IRA draw is income.
    expect(oi(noBasis[0])).toBeCloseTo(iraDraw(noBasis[0]), 0);
    expect(oi(withBasis[0])).toBeLessThan(oi(noBasis[0]));
  });

  // The trap this fix has to avoid: if the basis is never SPENT, the same
  // post-tax dollars shelter income year after year and the tax-free fraction
  // climbs as the balance falls.
  it("spends the basis — lifetime shelter is capped at the basis entered", () => {
    const withBasis = runProjection(build(100_000));
    const noBasis = runProjection(build(0));

    const totalOi = (ys: typeof withBasis) =>
      ys.reduce((s, y) => s + (y.taxDetail?.ordinaryIncome ?? 0), 0);

    const sheltered = totalOi(noBasis) - totalOi(withBasis);
    expect(sheltered).toBeGreaterThan(0);
    // Never more than the basis the advisor entered.
    expect(sheltered).toBeLessThanOrEqual(100_000 + 1);
  });

  it("leaves a $0-basis IRA fully taxable (no free lunch introduced)", () => {
    const years = runProjection(build(0));
    const y0 = years[0];
    const iraDraw = y0.withdrawals?.byAccount["acct-ira"] ?? 0;
    expect(iraDraw).toBeGreaterThan(0);
    expect(y0.taxDetail?.ordinaryIncome ?? 0).toBeCloseTo(iraDraw, 0);
  });
});
