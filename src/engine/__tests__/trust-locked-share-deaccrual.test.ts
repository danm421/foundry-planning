import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type {
  Account,
  ClientInfo,
  EntitySummary,
  Expense,
  FamilyMember,
  WithdrawalPriority,
} from "../types";

const TRUST_ID = "trust-locked";

// Single client, no deaths inside the plan window (default life expectancies
// land past 2028), zero inflation/growth for exact arithmetic.
const client: ClientInfo = {
  firstName: "Test",
  lastName: "Client",
  dateOfBirth: "1970-01-01",
  retirementAge: 65,
  planEndAge: 90,
  filingStatus: "single",
};

const familyMembers: FamilyMember[] = [
  {
    id: LEGACY_FM_CLIENT,
    role: "client",
    relationship: "other",
    firstName: "Test",
    lastName: "Client",
    dateOfBirth: "1970-01-01",
  },
];

const trust: EntitySummary = {
  id: TRUST_ID,
  name: "Locked Trust",
  entityType: "trust",
  trustSubType: "irrevocable",
  isIrrevocable: true,
  isGrantor: false,
  includeInPortfolio: false,
  accessibleToClient: false,
  grantor: "client",
};

function checking(value: number): Account {
  return {
    id: "acct-checking",
    name: "Checking",
    category: "cash",
    subType: "checking",
    titlingType: "jtwros",
    value,
    basis: value,
    growthRate: 0,
    rmdEnabled: false,
    isDefaultChecking: true,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  };
}

// 50/50 household / trust split brokerage.
function mixed(value: number, basis: number): Account {
  return {
    id: "acct-mixed",
    name: "Joint+Trust Brokerage",
    category: "taxable",
    subType: "brokerage",
    titlingType: "jtwros",
    value,
    basis,
    growthRate: 0,
    rmdEnabled: false,
    owners: [
      { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
      { kind: "entity", entityId: TRUST_ID, percent: 0.5 },
    ],
  };
}

const settings = {
  ...basePlanSettings,
  inflationRate: 0,
  planStartYear: 2026,
  planEndYear: 2028,
};

describe("F3 — locked entity shares de-accrue with the account", () => {
  it("full-drain sale: the reported entity share is 0 in the sale year and absent after", () => {
    const data = buildClientData({
      client,
      familyMembers,
      accounts: [checking(10_000), mixed(1_000_000, 400_000)],
      entities: [trust],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      assetTransactions: [
        { id: "sale-mixed", name: "Sell mixed", type: "sell", year: 2027, accountId: "acct-mixed" },
      ],
      planSettings: settings,
    });

    const years = runProjection(data);
    expect(years).toHaveLength(3);
    const [y26, y27, y28] = years;

    // Pre-sale year: locked share is the authored 50% slice.
    expect(y26.entityAccountSharesEoY?.get(TRUST_ID)?.get("acct-mixed")).toBeCloseTo(500_000, 2);

    // Sale year: the account is fully drained at BoY — the trust's reported
    // slice must clamp to the (zero) balance, not carry 500k of phantom.
    const saleYearShare = y27.entityAccountSharesEoY?.get(TRUST_ID)?.get("acct-mixed");
    expect(saleYearShare ?? 0).toBeCloseTo(0, 2);

    // Post-sale year: no ledger, no entry.
    expect(y28.entityAccountSharesEoY?.get(TRUST_ID)?.get("acct-mixed")).toBeUndefined();

    // Re-bucket conservation: the trust bucket must not carry the phantom slice
    // in the sale year or after.
    expect(y27.portfolioAssets.trustsAndBusinesses["acct-mixed"] ?? 0).toBeCloseTo(0, 2);
    expect(y28.portfolioAssets.trustsAndBusinesses["acct-mixed"] ?? 0).toBeCloseTo(0, 2);
  });

  it("household supplemental withdrawals stop at balance − locked share; trust principal survives", () => {
    // 300k/yr living expense, no income → supplemental draws from the 50/50
    // account. Household's tappable half is 500k; the trust's 500k must
    // survive all three years.
    const livingExpense: Expense = {
      id: "exp-living",
      name: "Living",
      type: "living",
      annualAmount: 300_000,
      growthRate: 0,
      startYear: 2026,
      endYear: 2028,
    };
    const strategy: WithdrawalPriority[] = [
      { accountId: "acct-mixed", priorityOrder: 1, startYear: 2026, endYear: 2028 },
    ];
    const data = buildClientData({
      client,
      familyMembers,
      accounts: [checking(10_000), mixed(1_000_000, 1_000_000)],
      entities: [trust],
      incomes: [],
      expenses: [livingExpense],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: strategy,
      planSettings: settings,
    });

    const years = runProjection(data);
    expect(years).toHaveLength(3);

    for (const y of years) {
      const ledger = y.accountLedgers["acct-mixed"];
      const locked = y.entityAccountSharesEoY?.get(TRUST_ID)?.get("acct-mixed") ?? 0;
      // The account never falls below the trust's locked slice…
      expect(ledger.endingValue).toBeGreaterThanOrEqual(locked - 0.01);
      // …and the locked slice never exceeds the account (audit F3 test gap:
      // Σ reported buckets ≤ account balance).
      expect(locked).toBeLessThanOrEqual(ledger.endingValue + 0.01);
      // Re-bucket conservation: family + trust slices == account value exactly.
      const familySlice = y.portfolioAssets.taxable["acct-mixed"] ?? 0;
      const trustSlice = y.portfolioAssets.trustsAndBusinesses["acct-mixed"] ?? 0;
      expect(familySlice + trustSlice).toBeCloseTo(ledger.endingValue, 2);
    }

    // With basis == value there is no gain, so draws are untaxed and the
    // arithmetic is exact: yr1 draws ~290k of the 500k household half; by yr2
    // capacity caps at balance − 500k and the account floors AT the locked
    // slice. The trust's 500k principal is intact at the horizon.
    const y28 = years[2];
    expect(y28.accountLedgers["acct-mixed"].endingValue).toBeCloseTo(500_000, 0);
    expect(y28.entityAccountSharesEoY?.get(TRUST_ID)?.get("acct-mixed")).toBeCloseTo(500_000, 0);
  });
});
