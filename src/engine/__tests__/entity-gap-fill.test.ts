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
import type { TaxYearParameters } from "../../lib/tax/types";

const TRUST_ID = "trust-1";

// Compressed 1041 brackets for 2026 — copied from the grantor-trust-distribution
// test fixture so trust 1041 cap-gains tax actually computes (without these the
// engine returns $0 federal tax and downstream cascade tests pass vacuously).
const TRUST_INCOME_2026 = [
  { from: 0, to: 3300, rate: 0.10 },
  { from: 3300, to: 12000, rate: 0.24 },
  { from: 12000, to: 16250, rate: 0.35 },
  { from: 16250, to: null as number | null, rate: 0.37 },
];
const TRUST_CAP_GAINS_2026 = [
  { from: 0, to: 3350, rate: 0 },
  { from: 3350, to: 16300, rate: 0.15 },
  { from: 16300, to: null as number | null, rate: 0.20 },
];
const taxYearRow2026: TaxYearParameters = {
  year: 2026,
  incomeBrackets: {
    married_joint: [{ from: 0, to: null, rate: 0.10 }],
    single: [{ from: 0, to: null, rate: 0.10 }],
    head_of_household: [{ from: 0, to: null, rate: 0.10 }],
    married_separate: [{ from: 0, to: null, rate: 0.10 }],
  },
  capGainsBrackets: {
    married_joint: { zeroPctTop: 94050, fifteenPctTop: 583750 },
    single: { zeroPctTop: 47025, fifteenPctTop: 518900 },
    head_of_household: { zeroPctTop: 63000, fifteenPctTop: 551350 },
    married_separate: { zeroPctTop: 47025, fifteenPctTop: 291850 },
  },
  trustIncomeBrackets: TRUST_INCOME_2026,
  trustCapGainsBrackets: TRUST_CAP_GAINS_2026,
  stdDeduction: { married_joint: 30000, single: 15000, head_of_household: 21900, married_separate: 15000 },
  amtExemption: { mfj: 137000, singleHoh: 88100, mfs: 68500 },
  amtBreakpoint2628: { mfjShoh: 239100, mfs: 119550 },
  amtPhaseoutStart: { mfj: 1237450, singleHoh: 618700, mfs: 618725 },
  ssTaxRate: 0.062,
  ssWageBase: 176100,
  medicareTaxRate: 0.0145,
  addlMedicareRate: 0.009,
  addlMedicareThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
  niitRate: 0.038,
  niitThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
  qbi: {
    thresholdMfj: 383900,
    thresholdSingleHohMfs: 191950,
    phaseInRangeMfj: 100000,
    phaseInRangeOther: 50000,
  },
  contribLimits: {
    ira401kElective: 23500, ira401kCatchup50: 7500, ira401kCatchup6063: 11250,
    iraTradLimit: 7000, iraCatchup50: 1000,
    simpleLimitRegular: 17000, simpleCatchup50: 4000,
    hsaLimitSelf: 4400, hsaLimitFamily: 8750, hsaCatchup55: 1000,
  },
};
const taxYearRow2027: TaxYearParameters = { ...taxYearRow2026, year: 2027 };
const taxYearRow2028: TaxYearParameters = { ...taxYearRow2026, year: 2028 };

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

function nonGrantorTrust(id: string = TRUST_ID): EntitySummary {
  return {
    id,
    name: "Family Trust",
    includeInPortfolio: false,
    isGrantor: false,
    entityType: "trust",
    isIrrevocable: true,
  };
}

function grantorTrust(id: string = TRUST_ID): EntitySummary {
  return {
    id,
    name: "Family IDGT",
    includeInPortfolio: true,
    isGrantor: true,
    entityType: "trust",
    isIrrevocable: true,
    grantor: "client",
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

  it("Case 2: shortfall fully covered — taxable partially drained, no warning", () => {
    // Cash $100k, taxable $200k (basis $100k), expense $250k.
    // After gap-fill: liquidate $150k from taxable → taxable $50k, checking $0.
    const data = buildData({
      accounts: [trustChecking(100_000), trustTaxable(200_000, 100_000)],
      expenses: [trustExpense(250_000)],
      entities: [nonGrantorTrust()],
    });

    const years = runProjection(data);
    const year0 = years[0];

    expect(year0.accountLedgers["trust-taxable"].endingValue).toBeCloseTo(50_000, 2);
    expect(year0.accountLedgers["trust-checking"].endingValue).toBeCloseTo(0, 2);
    expect(year0.trustWarnings ?? []).not.toContainEqual(
      expect.objectContaining({ code: "entity_overdraft" }),
    );
  });

  it("Case 3: expense within cash — no liquidation, taxable untouched", () => {
    // Cash $100k, taxable $200k, expense $80k. Cash covers it; gap-fill is a no-op.
    const data = buildData({
      accounts: [trustChecking(100_000), trustTaxable(200_000, 100_000)],
      expenses: [trustExpense(80_000)],
      entities: [nonGrantorTrust()],
    });

    const years = runProjection(data);
    const year0 = years[0];

    expect(year0.accountLedgers["trust-taxable"].endingValue).toBeCloseTo(200_000, 2);
    expect(year0.accountLedgers["trust-checking"].endingValue).toBeCloseTo(20_000, 2);

    // No liquidation entries on the taxable account, no overdraft warning.
    const taxableLiquidations = year0.accountLedgers["trust-taxable"].entries.filter(
      (e) => e.category === "withdrawal",
    );
    expect(taxableLiquidations).toHaveLength(0);
    expect(year0.trustWarnings ?? []).not.toContainEqual(
      expect.objectContaining({ code: "entity_overdraft" }),
    );
  });

  it("Case 4: two trusts each shortfall — independent gap-fills, no cross-tapping", () => {
    const trustAId = "trust-a";
    const trustBId = "trust-b";
    const trustACash: Account = {
      id: "a-checking", name: "A Checking", category: "cash", subType: "checking",
      value: 100_000, basis: 100_000, growthRate: 0, rmdEnabled: false,
      owners: [{ kind: "entity", entityId: trustAId, percent: 1 }],
      isDefaultChecking: true,
    };
    const trustATaxable: Account = {
      id: "a-taxable", name: "A Brokerage", category: "taxable", subType: "brokerage",
      value: 50_000, basis: 50_000, growthRate: 0, rmdEnabled: false,
      owners: [{ kind: "entity", entityId: trustAId, percent: 1 }],
    };
    const trustBCash: Account = {
      id: "b-checking", name: "B Checking", category: "cash", subType: "checking",
      value: 200_000, basis: 200_000, growthRate: 0, rmdEnabled: false,
      owners: [{ kind: "entity", entityId: trustBId, percent: 1 }],
      isDefaultChecking: true,
    };
    const trustBTaxable: Account = {
      id: "b-taxable", name: "B Brokerage", category: "taxable", subType: "brokerage",
      value: 100_000, basis: 100_000, growthRate: 0, rmdEnabled: false,
      owners: [{ kind: "entity", entityId: trustBId, percent: 1 }],
    };
    const expenseA: Expense = {
      id: "exp-a", name: "A Expense", type: "other",
      annualAmount: 200_000, startYear: 2026, endYear: 2026, growthRate: 0,
      ownerEntityId: trustAId,
    };
    const expenseB: Expense = {
      id: "exp-b", name: "B Expense", type: "other",
      annualAmount: 250_000, startYear: 2026, endYear: 2026, growthRate: 0,
      ownerEntityId: trustBId,
    };

    const data = buildData({
      accounts: [trustACash, trustATaxable, trustBCash, trustBTaxable],
      expenses: [expenseA, expenseB],
      entities: [nonGrantorTrust(trustAId), nonGrantorTrust(trustBId)],
    });

    const years = runProjection(data);
    const year0 = years[0];

    // Trust A: $100k cash + $50k taxable = $150k liquid vs $200k expense.
    //   Liquidate $50k taxable → checking residual -$50k, A taxable $0.
    expect(year0.accountLedgers["a-taxable"].endingValue).toBeCloseTo(0, 2);
    expect(year0.accountLedgers["a-checking"].endingValue).toBeCloseTo(-50_000, 2);

    // Trust B: $200k cash + $100k taxable = $300k liquid vs $250k expense.
    //   Liquidate $50k taxable → B checking $0, B taxable $50k.
    expect(year0.accountLedgers["b-taxable"].endingValue).toBeCloseTo(50_000, 2);
    expect(year0.accountLedgers["b-checking"].endingValue).toBeCloseTo(0, 2);

    // Only A overdrafts.
    const overdrafts = (year0.trustWarnings ?? []).filter((w) => w.code === "entity_overdraft");
    expect(overdrafts).toHaveLength(1);
    expect(overdrafts[0].entityId).toBe(trustAId);
  });

  it("Case 5: grantor trust liquidation gain lands on household 1040 the following year", () => {
    // Year 1: grantor trust liquidates $150k of taxable (basis $100k → 50% gain
    // ratio) → $75k cap gain stashed for year 2's drain.
    // Year 2: grantor → routed to household taxDetail.capitalGains.
    const data = buildData({
      accounts: [trustChecking(100_000), trustTaxable(200_000, 100_000)],
      expenses: [trustExpense(250_000)],
      entities: [grantorTrust()],
      planSettings: { ...onePassPlanSettings, planEndYear: 2027 },
    });

    const years = runProjection(data);
    expect(years).toHaveLength(2);

    // Year 2 (index 1): the deferred grantor cap gain shows up in household
    // taxable cap-gains.
    const yr2 = years[1];
    expect(yr2.taxDetail).toBeDefined();
    expect(yr2.taxDetail!.capitalGains).toBeCloseTo(75_000, 2);

    // And the trust-tax pass should NOT see this gain — grantor trusts don't
    // file 1041. (Map may not exist when there are no non-grantor trusts.)
    expect(yr2.trustTaxByEntity?.get(TRUST_ID)).toBeUndefined();
  });

  it("Case 6: non-grantor trust liquidation gain lands on the trust-tax pass the following year", () => {
    // Mirror of case 5 but for a non-grantor trust. $75k gain in year 1 →
    // year 2's trust-tax pass picks it up via assetTransactionGains carry-in.
    const data = buildData({
      accounts: [trustChecking(100_000), trustTaxable(200_000, 100_000)],
      expenses: [trustExpense(250_000)],
      entities: [nonGrantorTrust()],
      planSettings: { ...onePassPlanSettings, planEndYear: 2027, taxEngineMode: "bracket" },
      taxYearRows: [taxYearRow2026, taxYearRow2027],
    });

    const years = runProjection(data);
    expect(years).toHaveLength(2);

    const yr2 = years[1];
    const trustRow = yr2.trustTaxByEntity?.get(TRUST_ID);
    expect(trustRow).toBeDefined();
    expect(trustRow!.recognizedCapGains).toBeCloseTo(75_000, 2);
    expect(trustRow!.federalCapGainsTax).toBeGreaterThan(0);
    expect(trustRow!.total).toBeGreaterThan(0);

    // Household 1040 must NOT see this gain.
    expect(yr2.taxDetail!.capitalGains).toBe(0);
  });

  it("Case 7: trust with only real_estate after cash — overdraft warning, real-estate untouched", () => {
    // Real estate is in the untappable category set, so even though the trust
    // has $200k of value sitting in real estate, gap-fill must not liquidate it.
    const trustHome: Account = {
      id: "trust-home",
      name: "Trust Real Estate",
      category: "real_estate",
      subType: "investment_property",
      value: 200_000,
      basis: 100_000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "entity", entityId: TRUST_ID, percent: 1 }],
    };

    const data = buildData({
      accounts: [trustChecking(100_000), trustHome],
      expenses: [trustExpense(250_000)],
      entities: [nonGrantorTrust()],
    });

    const years = runProjection(data);
    const year0 = years[0];

    // Real-estate end-value is unchanged; checking has the full deficit.
    expect(year0.accountLedgers["trust-home"].endingValue).toBeCloseTo(200_000, 2);
    expect(year0.accountLedgers["trust-checking"].endingValue).toBeCloseTo(-150_000, 2);

    const overdraft = (year0.trustWarnings ?? []).find(
      (w) => w.code === "entity_overdraft" && w.entityId === TRUST_ID,
    );
    expect(overdraft).toBeDefined();
    expect((overdraft as { shortfall: number }).shortfall).toBeCloseTo(150_000, 2);

    // No withdrawal entries on the real-estate ledger.
    const homeWithdrawals = year0.accountLedgers["trust-home"].entries.filter(
      (e) => e.category === "withdrawal",
    );
    expect(homeWithdrawals).toHaveLength(0);
  });

  it("Case 8: multi-year cascade — year 1 liquidation feeds year 2 trust 1041 tax which retriggers gap-fill", () => {
    // Year 1: trust cash $100k, taxable $200k (basis $100k), expense $250k.
    //   Gap-fill liquidates $150k taxable → $75k gain stashed.
    //   End-of-year 1: trust checking $0, trust taxable $50k.
    // Year 2: no expense; trust-tax pass picks up $75k recognized cap gain →
    //   computes 1041 tax (≥ $11.7k from the $58.7k portion in the 20% bracket
    //   alone) → debits trust checking, which was sitting at $0, so it goes
    //   negative → year 2 gap-fill liquidates additional taxable.
    const data = buildData({
      accounts: [trustChecking(100_000), trustTaxable(200_000, 100_000)],
      expenses: [trustExpense(250_000)],
      entities: [nonGrantorTrust()],
      planSettings: { ...onePassPlanSettings, planEndYear: 2028, taxEngineMode: "bracket" },
      taxYearRows: [taxYearRow2026, taxYearRow2027, taxYearRow2028],
    });

    const years = runProjection(data);
    expect(years).toHaveLength(3);

    // End-of-year-1: gap-fill leaves taxable at $50k, checking at $0 (cash drained
    // by the $250k expense, refilled by $150k liquidation).
    expect(years[0].accountLedgers["trust-taxable"].endingValue).toBeCloseTo(50_000, 2);
    expect(years[0].accountLedgers["trust-checking"].endingValue).toBeCloseTo(0, 2);

    // Year 2: trust 1041 tax recognized + gap-fill cascade.
    const yr2 = years[1];
    const trustRow = yr2.trustTaxByEntity?.get(TRUST_ID);
    expect(trustRow).toBeDefined();
    expect(trustRow!.recognizedCapGains).toBeCloseTo(75_000, 2);
    expect(trustRow!.total).toBeGreaterThan(11_000);

    // The cascade liquidates additional taxable to cover the trust tax debit.
    // Trust taxable should now be below $50k (year-1 end value).
    expect(yr2.accountLedgers["trust-taxable"].endingValue).toBeLessThan(50_000);

    // Cascade settles — by year 3, no further gap-fill triggers an overdraft if
    // remaining taxable suffices, OR an overdraft warning surfaces. Either is
    // acceptable; just verify the projection completed all three years cleanly.
    expect(yr2.accountLedgers["trust-taxable"].endingValue).toBeGreaterThanOrEqual(0);
  });
});
