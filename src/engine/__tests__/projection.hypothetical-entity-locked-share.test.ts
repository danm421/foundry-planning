/**
 * Regression: the per-year hypothetical estate tax must value a business's
 * slice of a split-owned account at its locked EoY share — not at
 * `drainedBalance × ownerPercent`.
 *
 * A household cash shortfall draws a co-owned cash account down. The entity's
 * locked share (entityAccountSharesEoY) is protected from that drawdown, and
 * the real death-event path already passes it. This test locks in that the
 * in-loop `computeHypotheticalEstateTax` call passes it too, so the Estate Tax
 * report's business line doesn't net the household's liquidation against the
 * business's own cash.
 */
import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type {
  Account,
  ClientData,
  Expense,
  EntitySummary,
  FamilyMember,
  PlanSettings,
} from "../types";
import { LEGACY_FM_CLIENT } from "../ownership";

const planSettings: PlanSettings = {
  flatFederalRate: 0.24,
  flatStateRate: 0.05,
  inflationRate: 0,
  planStartYear: 2026,
  planEndYear: 2027,
};

const client = {
  firstName: "Cooper",
  lastName: "Test",
  dateOfBirth: "1970-01-01",
  retirementAge: 65,
  planEndAge: 90,
  filingStatus: "single" as const,
};

const clientFamilyMember: FamilyMember = {
  id: LEGACY_FM_CLIENT,
  role: "client",
  relationship: "other",
  firstName: "Cooper",
  lastName: "Test",
  dateOfBirth: "1970-01-01",
};

// Savings account split 80% client / 20% an LLC the client owns 100%.
// It is the household default checking, so the household's cash shortfall
// draws the account's total balance down.
const savings: Account = {
  id: "savings",
  name: "Savings Account",
  category: "cash",
  subType: "savings",
  titlingType: "jtwros",
  value: 100_000,
  basis: 100_000,
  growthRate: 0,
  rmdEnabled: false,
  owners: [
    { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.8 },
    { kind: "entity", entityId: "biz", percent: 0.2 },
  ],
  isDefaultChecking: true,
};

const business: EntitySummary = {
  id: "biz",
  name: "Test Bus",
  includeInPortfolio: true,
  isGrantor: false,
  entityType: "llc",
  value: 0,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
} as unknown as EntitySummary;

// $30k/yr living expense with no income — a pure household cash shortfall
// that draws the savings account down ($100k → $70k by EoY 2026).
const livingExpense: Expense = {
  id: "exp1",
  type: "living",
  name: "Living Expenses",
  annualAmount: 30_000,
  startYear: 2026,
  endYear: 2027,
  growthRate: 0,
};

function mkData(): ClientData {
  return {
    client,
    accounts: [savings],
    incomes: [],
    expenses: [livingExpense],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings,
    familyMembers: [clientFamilyMember],
    entities: [business],
    giftEvents: [],
  } as unknown as ClientData;
}

describe("hypothetical estate tax: business slice of a drained split-owned account", () => {
  it("values the business line at its locked EoY share, not the drained balance", () => {
    const years = runProjection(mkData());
    const y2026 = years.find((y) => y.year === 2026)!;

    // Household drew the savings account down: $100k − $30k = $70k year-end.
    expect(y2026.accountLedgers["savings"].endingValue).toBeCloseTo(70_000, 0);

    const businessLine = y2026.hypotheticalEstateTax!.primaryFirst.firstDeath.grossEstateLines?.find(
      (l) => l.entityId === "biz",
    );
    expect(businessLine).toBeDefined();
    // Locked share: BoY $100k × 20% with no growth = $20k. The naive
    // (buggy) fallback would be drainedBalance $70k × 20% = $14k.
    expect(businessLine!.amount).toBeCloseTo(20_000, 0);
  });
});
