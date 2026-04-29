import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type {
  ClientData,
  Account,
  Expense,
  EntitySummary,
  PlanSettings,
  FamilyMember,
  ClientInfo,
} from "../types";
import { LEGACY_FM_CLIENT } from "../ownership";

const TRUST_ID = "trust-1";

const baseClient: ClientInfo = {
  firstName: "John",
  lastName: "Smith",
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
    firstName: "John",
    lastName: "Smith",
    dateOfBirth: "1970-01-01",
  },
];

const onePassPlanSettings: PlanSettings = {
  flatFederalRate: 0.22,
  flatStateRate: 0.05,
  inflationRate: 0,
  planStartYear: 2026,
  planEndYear: 2026,
};

function trustChecking(value: number): Account {
  return {
    id: "trust-checking",
    name: "Trust Checking",
    category: "cash",
    subType: "checking",
    value,
    basis: value,
    growthRate: 0,
    rmdEnabled: false,
    owners: [{ kind: "entity", entityId: TRUST_ID, percent: 1 }],
    isDefaultChecking: true,
  };
}

function trustTaxable(value: number, basis: number): Account {
  return {
    id: "trust-taxable",
    name: "Trust Brokerage",
    category: "taxable",
    subType: "brokerage",
    value,
    basis,
    growthRate: 0,
    rmdEnabled: false,
    owners: [{ kind: "entity", entityId: TRUST_ID, percent: 1 }],
  };
}

function trustExpense(amount: number): Expense {
  return {
    id: "exp-trust",
    name: "Trust Expense",
    type: "other",
    annualAmount: amount,
    startYear: 2026,
    endYear: 2026,
    growthRate: 0,
    ownerEntityId: TRUST_ID,
  };
}

function nonGrantorTrust(): EntitySummary {
  return {
    id: TRUST_ID,
    name: "Family Trust",
    includeInPortfolio: false,
    isGrantor: false,
    entityType: "trust",
    isIrrevocable: true,
  };
}

function buildData(overrides: Partial<ClientData>): ClientData {
  return {
    client: baseClient,
    accounts: [],
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: onePassPlanSettings,
    familyMembers,
    giftEvents: [],
    ...overrides,
  };
}

describe("Entity gap-fill (step 12c)", () => {
  it("Case 1: shortfall partially covered — checking residual negative, taxable drained, overdraft warning", () => {
    // Trust cash $100k, taxable $200k (basis $100k → 50% gain), expense $350k.
    // After gap-fill: liquidate the full $200k taxable, refill checking. $250k
    // expense overflow over $100k cash → checking goes to -$150k → liquidation
    // brings it to +$50k, still short of the $250k drain → checking ends at -$50k.
    const data = buildData({
      accounts: [trustChecking(100_000), trustTaxable(200_000, 100_000)],
      expenses: [trustExpense(350_000)],
      entities: [nonGrantorTrust()],
    });

    const years = runProjection(data);
    const year0 = years[0];

    expect(year0.accountLedgers["trust-taxable"].endingValue).toBeCloseTo(0, 2);
    expect(year0.accountLedgers["trust-checking"].endingValue).toBeCloseTo(-50_000, 2);

    const warnings = year0.trustWarnings ?? [];
    const overdraft = warnings.find(
      (w): w is Extract<typeof w, { code: "entity_overdraft" }> =>
        w.code === "entity_overdraft" && w.entityId === TRUST_ID,
    );
    expect(overdraft).toBeDefined();
    expect(overdraft!.shortfall).toBeCloseTo(50_000, 2);

    // Liquidation must surface as a withdrawal ledger entry on the trust taxable
    // account so advisors can audit the cash trail.
    const taxableLedgerEntries = year0.accountLedgers["trust-taxable"].entries;
    const liquidationEntry = taxableLedgerEntries.find(
      (e) => e.category === "withdrawal",
    );
    expect(liquidationEntry).toBeDefined();
    expect(liquidationEntry!.amount).toBeCloseTo(-200_000, 2);
  });
});
