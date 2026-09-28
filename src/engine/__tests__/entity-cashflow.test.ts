// src/engine/__tests__/entity-cashflow.test.ts
import { describe, it, expect } from "vitest";
import {
  buildEntityValueAtYear,
  computeBusinessAccountCashFlow,
  computeEntityCashFlow,
  type BusinessAccountMetadata,
  type EntityMetadata,
  type TrustCashFlowRow,
} from "../entity-cashflow";
import { runProjection } from "../projection";
import type {
  ProjectionYear,
  Income,
  Expense,
  ClientData,
  Account,
  PlanSettings,
  FamilyMember,
} from "../types";
import type { TaxYearParameters } from "../../lib/tax/types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";
import { buildCrtLifecycleFixture, CRT_FIXTURE_IDS } from "./_fixtures/crt";

/** The trust row for `entityId`, or a loud failure — never a silent cast. */
function trustRow(y: ProjectionYear, entityId: string): TrustCashFlowRow {
  const row = y.entityCashFlow.get(entityId);
  if (row?.kind !== "trust") throw new Error(`no trust row for ${entityId} in ${y.year}`);
  return row;
}
/** Adapts a year-invariant owner Map to the per-year resolver input — for the
 *  cases that predate per-year ownership and own the same share every year. */
function ownersFrom(map: Map<string, { entityId: string; percent: number }>) {
  return {
    accountEntityOwnersAt: (id: string) => {
      const owner = map.get(id);
      return owner ? [owner] : [];
    },
    candidateAccountIds: [...map.keys()],
  };
}
/** The columns the Trust table adds up. beginning + in − out must equal ending. */
const rowIdentityGap = (r: TrustCashFlowRow) =>
  r.beginningBalance + r.transfersIn + r.growth + r.income
  - r.totalDistributions - r.expenses - r.taxes - r.endingBalance;

function makeYear(year: number): ProjectionYear {
  // Minimal-shape ProjectionYear for unit testing the cashflow pass.
  // Most fields are unused by computeEntityCashFlow; safe to default.
  return {
    year,
    ages: { client: 60 + (year - 2026), spouse: 58 + (year - 2026) },
    income: {
      salaries: 0,
      socialSecurity: 0,
      business: 0,
      trust: 0,
      deferred: 0,
      capitalGains: 0,
      other: 0,
      total: 0,
      bySource: {},
    },
    expenses: {
      living: 0,
      liabilities: 0,
      other: 0,
      insurance: 0,
      realEstate: 0,
      taxes: 0,
      cashGifts: 0,
      total: 0,
      bySource: {},
      byLiability: {},
      interestByLiability: {},
    },
    withdrawals: { byAccount: {}, total: 0 },
    entityWithdrawals: { byAccount: {}, total: 0 },
    savings: { byAccount: {}, total: 0, employerTotal: 0 },
    totalIncome: 0,
    totalExpenses: 0,
    netCashFlow: 0,
    portfolioAssets: {
      taxable: {},
      cash: {},
      retirement: {},
      realEstate: {},
      business: {},
      lifeInsurance: {},
      taxableTotal: 0,
      cashTotal: 0,
      retirementTotal: 0,
      realEstateTotal: 0,
      businessTotal: 0,
      lifeInsuranceTotal: 0,
      trustsAndBusinesses: {},
      trustsAndBusinessesTotal: 0,
      accessibleTrustAssets: {},
      accessibleTrustAssetsTotal: 0,
      total: 0,
    },
    accountLedgers: {},
    accountBasisBoY: {},
    liabilityBalancesBoY: {},
    hypotheticalEstateTax: { client: 0, spouse: 0, joint: 0 } as never, // shape stub
    charitableOutflows: 0,
    entityCashFlow: new Map(),
  } as unknown as ProjectionYear;
}

describe("computeEntityCashFlow", () => {
  it("populates an empty map when there are no entities", () => {
    const years = [makeYear(2026), makeYear(2027)];
    computeEntityCashFlow({
      years,
      entitiesById: new Map(),
      ...ownersFrom(new Map()),
      giftsByEntityYear: new Map(),
      incomes: [],
      expenses: [],
      entityFlowOverrides: [],
    });
    expect(years[0].entityCashFlow.size).toBe(0);
    expect(years[1].entityCashFlow.size).toBe(0);
  });

  it("computes trust BoY/EoY balance from entity-owned account ledgers", () => {
    const trust = {
      id: "trust-1",
      name: "Smith SLAT",
      entityType: "trust" as const,
      trustSubType: "irrevocable" as const,
      isGrantor: false,
      initialValue: 0,
      initialBasis: 0,
    };
    const y = makeYear(2026);
    y.accountLedgers = {
      "acc-1": {
        beginningValue: 100_000,
        endingValue: 105_000,
        growth: 5_000,
        contributions: 0,
        distributions: 0,
        internalContributions: 0,
        internalDistributions: 0,
        rmdAmount: 0,
        fees: 0,
        entries: [],
      },
      "acc-2": {
        beginningValue: 50_000,
        endingValue: 53_000,
        growth: 3_000,
        contributions: 0,
        distributions: 0,
        internalContributions: 0,
        internalDistributions: 0,
        rmdAmount: 0,
        fees: 0,
        entries: [],
      },
      "acc-3": {
        beginningValue: 200_000,
        endingValue: 210_000,
        growth: 10_000,
        contributions: 0,
        distributions: 0,
        internalContributions: 0,
        internalDistributions: 0,
        rmdAmount: 0,
        fees: 0,
        entries: [],
      }, // household-owned, must NOT count
    };
    computeEntityCashFlow({
      years: [y],
      entitiesById: new Map([["trust-1", trust]]),
      ...ownersFrom(new Map([
        ["acc-1", { entityId: "trust-1", percent: 1 }],
        ["acc-2", { entityId: "trust-1", percent: 1 }],
      ])),
      giftsByEntityYear: new Map(),
      incomes: [],
      expenses: [],
      entityFlowOverrides: [],
    });
    const row = y.entityCashFlow.get("trust-1");
    expect(row?.kind).toBe("trust");
    expect(row && row.kind === "trust" && row.beginningBalance).toBe(150_000);
    expect(row && row.kind === "trust" && row.endingBalance).toBe(158_000);
    expect(row && row.kind === "trust" && row.growth).toBe(8_000);
  });

  it("populates trust income, expenses, and totalDistributions", () => {
    const trust = {
      id: "trust-1",
      name: "Smith SLAT",
      entityType: "trust" as const,
      trustSubType: "irrevocable" as const,
      isGrantor: false,
      initialValue: 0,
      initialBasis: 0,
    };
    const y = makeYear(2026);
    y.accountLedgers = {
      "trust-cash": {
        beginningValue: 0,
        endingValue: 0,
        growth: 0,
        contributions: 75_000,
        distributions: 60_000,
        internalContributions: 0,
        internalDistributions: 0,
        rmdAmount: 0,
        fees: 0,
        entries: [
          { category: "income", label: "Rental", amount: 75_000, sourceId: "inc-rental" },
          { category: "expense", label: "Management fees", amount: -10_000, sourceId: "exp-mgmt" },
        ],
      },
    };
    y.trustDistributionsByEntity = new Map([["trust-1", 50_000]]);
    computeEntityCashFlow({
      years: [y],
      entitiesById: new Map([["trust-1", trust]]),
      ...ownersFrom(new Map([["trust-cash", { entityId: "trust-1", percent: 1 }]])),
      giftsByEntityYear: new Map(),
      incomes: [],
      expenses: [],
      entityFlowOverrides: [],
    });
    const row = y.entityCashFlow.get("trust-1")!;
    expect(row.kind).toBe("trust");
    expect((row as { kind: "trust"; income: number }).income).toBe(75_000);
    expect((row as { kind: "trust"; expenses: number }).expenses).toBe(10_000);
    expect((row as { kind: "trust"; totalDistributions: number }).totalDistributions).toBe(50_000);
  });

  it("keeps a distribution debit (booked as entity_distribution) out of expenses — it is already in totalDistributions", () => {
    const trust = {
      id: "trust-1",
      name: "Smith SLAT",
      entityType: "trust" as const,
      trustSubType: "irrevocable" as const,
      isGrantor: false,
      initialValue: 0,
      initialBasis: 0,
    };
    const y = makeYear(2026);
    y.accountLedgers = {
      "trust-cash": {
        beginningValue: 100_000,
        endingValue: 50_000,
        growth: 0,
        contributions: 0,
        distributions: 50_000,
        internalContributions: 0,
        internalDistributions: 0,
        rmdAmount: 0,
        fees: 0,
        entries: [
          {
            category: "entity_distribution",
            label: "Non-grantor trust distribution out",
            amount: -50_000,
            sourceId: "trust-1",
          },
        ],
      },
    };
    y.trustDistributionsByEntity = new Map([["trust-1", 50_000]]);
    computeEntityCashFlow({
      years: [y],
      entitiesById: new Map([["trust-1", trust]]),
      ...ownersFrom(new Map([["trust-cash", { entityId: "trust-1", percent: 1 }]])),
      giftsByEntityYear: new Map(),
      incomes: [],
      expenses: [],
      entityFlowOverrides: [],
    });
    const row = trustRow(y, "trust-1");
    expect(row.totalDistributions).toBe(50_000);
    expect(row.expenses).toBe(0);
    expect(rowIdentityGap(row)).toBe(0);
  });

  it("excludes asset-sale proceeds from trust income", () => {
    // Selling a trust-owned asset deposits the net proceeds into the trust's
    // cash as an inflow, but that's an asset→cash conversion — not income. The
    // taxable component (the capital gain) is handled separately on the 1040 /
    // 1041, so the proceeds must NOT inflate the trust's reported income.
    const trust = {
      id: "trust-1",
      name: "IDGT",
      entityType: "trust" as const,
      trustSubType: "idgt" as const,
      isGrantor: true,
      initialValue: 0,
      initialBasis: 0,
    };
    const y = makeYear(2026);
    y.accountLedgers = {
      "trust-cash": {
        beginningValue: 0,
        endingValue: 504_288,
        growth: 0,
        contributions: 579_288,
        distributions: 0,
        internalContributions: 0,
        internalDistributions: 0,
        rmdAmount: 0,
        fees: 0,
        entries: [
          { category: "income", label: "Rental", amount: 75_000, sourceId: "inc-rental" },
          { category: "income", label: "Sale proceeds: sell IDGT real estate", amount: 504_288, sourceId: "sale-1", isSaleProceeds: true },
        ],
      },
    };
    computeEntityCashFlow({
      years: [y],
      entitiesById: new Map([["trust-1", trust]]),
      ...ownersFrom(new Map([["trust-cash", { entityId: "trust-1", percent: 1 }]])),
      giftsByEntityYear: new Map(),
      incomes: [],
      expenses: [],
      entityFlowOverrides: [],
    });
    const row = y.entityCashFlow.get("trust-1")!;
    expect((row as { kind: "trust"; income: number }).income).toBe(75_000);
  });

  it("populates Transfers In from gifts and death-event bequests", () => {
    const trust = {
      id: "trust-1",
      name: "Smith SLAT",
      entityType: "trust" as const,
      trustSubType: "irrevocable" as const,
      isGrantor: false,
      initialValue: 0,
      initialBasis: 0,
    };
    const y2026 = makeYear(2026);
    const y2027 = makeYear(2027);
    // DeathTransfer uses recipientKind: "entity" + recipientId for entity recipients.
    y2027.deathTransfers = [
      {
        year: 2027,
        deathOrder: 1,
        deceased: "client",
        sourceAccountId: "acc-x",
        sourceAccountName: "Joint Brokerage",
        sourceLiabilityId: null,
        sourceLiabilityName: null,
        via: "will",
        recipientKind: "entity",
        recipientId: "trust-1",
        recipientLabel: "Smith SLAT",
        amount: 250_000,
        basis: 100_000,
        resultingAccountId: null,
        resultingLiabilityId: null,
      } as never,
      // A non-entity transfer in the same year must NOT count.
      {
        year: 2027,
        deathOrder: 1,
        deceased: "client",
        sourceAccountId: "acc-y",
        sourceAccountName: "IRA",
        sourceLiabilityId: null,
        sourceLiabilityName: null,
        via: "beneficiary_designation",
        recipientKind: "spouse",
        recipientId: null,
        recipientLabel: "Spouse",
        amount: 999_999,
        basis: 0,
        resultingAccountId: null,
        resultingLiabilityId: null,
      } as never,
      // An entity transfer to a different entity must NOT count.
      {
        year: 2027,
        deathOrder: 1,
        deceased: "client",
        sourceAccountId: "acc-z",
        sourceAccountName: "Other",
        sourceLiabilityId: null,
        sourceLiabilityName: null,
        via: "will",
        recipientKind: "entity",
        recipientId: "trust-other",
        recipientLabel: "Other Trust",
        amount: 999_999,
        basis: 0,
        resultingAccountId: null,
        resultingLiabilityId: null,
      } as never,
    ];
    computeEntityCashFlow({
      years: [y2026, y2027],
      entitiesById: new Map([["trust-1", trust]]),
      ...ownersFrom(new Map()),
      giftsByEntityYear: new Map([["trust-1", new Map([[2026, 100_000]])]]),
      incomes: [],
      expenses: [],
      entityFlowOverrides: [],
    });
    const row2026 = y2026.entityCashFlow.get("trust-1")!;
    const row2027 = y2027.entityCashFlow.get("trust-1")!;
    expect((row2026 as { kind: "trust"; transfersIn: number }).transfersIn).toBe(100_000);
    expect((row2027 as { kind: "trust"; transfersIn: number }).transfersIn).toBe(250_000);
  });

  it("populates trust Taxes from trustTaxByEntity for non-grantor; zero for grantor", () => {
    const nongrantor = {
      id: "ng-1",
      name: "Non-Grantor",
      entityType: "trust" as const,
      trustSubType: "irrevocable" as const,
      isGrantor: false,
      initialValue: 0,
      initialBasis: 0,
    };
    const grantor = {
      id: "g-1",
      name: "Grantor",
      entityType: "trust" as const,
      trustSubType: "irrevocable" as const,
      isGrantor: true,
      initialValue: 0,
      initialBasis: 0,
    };
    const y = makeYear(2026);
    // TrustTaxBreakdown total field is `total`, not `totalTax`.
    y.trustTaxByEntity = new Map([
      ["ng-1", { total: 12_000 } as never],
      ["g-1", { total: 9_000 } as never],
    ]);
    computeEntityCashFlow({
      years: [y],
      entitiesById: new Map<string, EntityMetadata>([
        ["ng-1", nongrantor],
        ["g-1", grantor],
      ]),
      ...ownersFrom(new Map()),
      giftsByEntityYear: new Map(),
      incomes: [],
      expenses: [],
      entityFlowOverrides: [],
    });
    const ng = y.entityCashFlow.get("ng-1")!;
    const g = y.entityCashFlow.get("g-1")!;
    expect((ng as { kind: "trust"; taxes: number }).taxes).toBe(12_000);
    expect((g as { kind: "trust"; taxes: number }).taxes).toBe(0);
  });

  it("includes charitable outflows and termination payouts in totalDistributions", () => {
    const trust = {
      id: "clut-1",
      name: "Smith CLT",
      entityType: "trust" as const,
      trustSubType: "clt" as const,
      isGrantor: false,
      initialValue: 0,
      initialBasis: 0,
    };
    const y = makeYear(2030);
    y.accountLedgers = {};
    y.charitableOutflowDetail = [
      {
        kind: "clt_payment",
        trustId: "clut-1",
        trustName: "Smith CLT",
        charityId: "char-1",
        amount: 25_000,
      } as never,
    ];
    y.trustTerminations = [
      {
        trustId: "clut-1",
        trustName: "Smith CLT",
        totalDistributed: 500_000,
        toBeneficiaries: [],
      } as never,
    ];
    computeEntityCashFlow({
      years: [y],
      entitiesById: new Map([["clut-1", trust]]),
      ...ownersFrom(new Map()),
      giftsByEntityYear: new Map(),
      incomes: [],
      expenses: [],
      entityFlowOverrides: [],
    });
    const row = y.entityCashFlow.get("clut-1")!;
    expect((row as { kind: "trust"; totalDistributions: number }).totalDistributions).toBe(525_000);
  });

  it("computes business row: flat value + basis + growth + income/expenses + distribution + retained + EoY", () => {
    const llc = { id: "llc-1", name: "Smith Holdings", entityType: "llc" as const, trustSubType: null, isGrantor: false, initialValue: 50_000_000, initialBasis: 1_000_000 };
    const y = makeYear(2026);
    // The engine wrote the entity_distribution debit + household credit during
    // the projection. The report reads the debit on the entity's checking.
    y.accountLedgers = {
      "biz-cash": { beginningValue: 0, endingValue: 0, growth: 0, contributions: 10_000_000, distributions: 5_800_000, internalContributions: 0, internalDistributions: 0, rmdAmount: 0, fees: 0, entries: [
        { category: "income",              label: "Income: Operating",                  amount:  10_000_000, sourceId: "biz-inc" },
        { category: "expense",             label: "Expense: Operating",                 amount:  -4_200_000, sourceId: "biz-exp" },
        { category: "entity_distribution", label: "Distribution from Smith Holdings",   amount:  -5_800_000, sourceId: "llc-1"   },
      ] },
    };
    const incomes: Income[] = [
      { id: "biz-inc", type: "business", name: "Operating", annualAmount: 10_000_000, startYear: 2026, endYear: 2055, growthRate: 0, owner: "joint", ownerEntityId: "llc-1" } as never,
    ];
    const expenses: Expense[] = [
      { id: "biz-exp", type: "other", name: "Operating", annualAmount: 4_200_000, startYear: 2026, endYear: 2055, growthRate: 0, ownerEntityId: "llc-1" } as never,
    ];
    computeEntityCashFlow({
      years: [y],
      entitiesById: new Map([["llc-1", llc]]),
      ...ownersFrom(new Map([["biz-cash", { entityId: "llc-1", percent: 1 }]])),
      giftsByEntityYear: new Map(),
      incomes,
      expenses,
      entityFlowOverrides: [],
    });
    const row = y.entityCashFlow.get("llc-1")!;
    expect(row.kind).toBe("business");
    if (row.kind !== "business") return;
    expect(row.beginningTotalValue).toBe(50_000_000);   // entities.value (no entity-owned BoY balance on biz-cash)
    expect(row.beginningBasis).toBe(1_000_000);
    expect(row.growth).toBe(0);                          // 0 flat-value growth + 0 from cash account
    expect(row.income).toBe(10_000_000);
    expect(row.expenses).toBe(4_200_000);
    expect(row.annualDistribution).toBe(5_800_000);
    expect(row.retainedEarnings).toBe(0);                // (10M − 4.2M) − 5.8M
    expect(row.endingTotalValue).toBe(50_000_000);       // BoY + 0 growth + 0 retained
    expect(row.endingBasis).toBe(1_000_000);
  });

  it("aggregates BoY basis from entity-owned accounts (full + split ownership)", () => {
    // Entity owns 100% of biz-cash ($50k basis) and 20% of a shared
    // investment account ($100k basis → entity's share = $20k). Both should
    // roll into beginningBasis alongside the entity's standalone initialBasis.
    const llc = {
      id: "llc-1",
      name: "Smith Holdings",
      entityType: "llc" as const,
      trustSubType: null,
      isGrantor: false,
      initialValue: 0,
      initialBasis: 10_000,
    };
    const y = makeYear(2026);
    y.accountLedgers = {
      "biz-cash": { beginningValue: 0, endingValue: 0, growth: 0, contributions: 0, distributions: 0, internalContributions: 0, internalDistributions: 0, rmdAmount: 0, fees: 0, entries: [] } as never,
      "shared-inv": { beginningValue: 100_000, endingValue: 100_000, growth: 0, contributions: 0, distributions: 0, internalContributions: 0, internalDistributions: 0, rmdAmount: 0, fees: 0, entries: [] } as never,
    };
    y.accountBasisBoY = { "biz-cash": 50_000, "shared-inv": 100_000 };
    computeEntityCashFlow({
      years: [y],
      entitiesById: new Map([["llc-1", llc]]),
      ...ownersFrom(new Map([
        ["biz-cash", { entityId: "llc-1", percent: 1 }],
        ["shared-inv", { entityId: "llc-1", percent: 0.2 }],
      ])),
      giftsByEntityYear: new Map(),
      incomes: [],
      expenses: [],
      entityFlowOverrides: [],
    });
    const row = y.entityCashFlow.get("llc-1")!;
    if (row.kind !== "business") throw new Error("expected business row");
    // 10k initialBasis + 50k (full) + 20k (20% × 100k) = 80k
    expect(row.beginningBasis).toBe(80_000);
  });

  it("pass-through entity: retained earnings increase endingBasis (already taxed at owner)", () => {
    // Grantor LLC keeps 30% of net income (70% distributed). The retained
    // $24,000 ($80k income − $20k expense − 70% × $60k = $42k distribution)
    // is post-tax money that increases the owner's outside basis.
    //
    // Wait — math: 80k income - 20k expense = 60k net; distribution 70% = 42k
    // (we feed this as the entity_distribution debit in the ledger);
    // retained = 60k - 42k = 18k. So expected basis delta = 18k.
    const llc = {
      id: "llc-1",
      name: "Grantor LLC",
      entityType: "llc" as const,
      trustSubType: null,
      isGrantor: true,
      initialValue: 0,
      initialBasis: 5_000,
    };
    const y = makeYear(2026);
    y.accountLedgers = {
      "biz-cash": { beginningValue: 0, endingValue: 18_000, growth: 0, contributions: 80_000, distributions: 62_000, internalContributions: 0, internalDistributions: 0, rmdAmount: 0, fees: 0, entries: [
        { category: "income",              label: "Income",        amount:  80_000, sourceId: "biz-inc" },
        { category: "expense",             label: "Expense",       amount: -20_000, sourceId: "biz-exp" },
        { category: "entity_distribution", label: "Distribution",  amount: -42_000, sourceId: "llc-1"   },
      ] } as never,
    };
    const incomes: Income[] = [
      { id: "biz-inc", type: "business", name: "Op", annualAmount: 80_000, startYear: 2026, endYear: 2055, growthRate: 0, owner: "client", ownerEntityId: "llc-1" } as never,
    ];
    const expenses: Expense[] = [
      { id: "biz-exp", type: "other", name: "Op", annualAmount: 20_000, startYear: 2026, endYear: 2055, growthRate: 0, ownerEntityId: "llc-1" } as never,
    ];
    computeEntityCashFlow({
      years: [y],
      entitiesById: new Map([["llc-1", llc]]),
      ...ownersFrom(new Map([["biz-cash", { entityId: "llc-1", percent: 1 }]])),
      giftsByEntityYear: new Map(),
      incomes,
      expenses,
      entityFlowOverrides: [],
    });
    const row = y.entityCashFlow.get("llc-1")!;
    if (row.kind !== "business") throw new Error("expected business row");
    expect(row.retainedEarnings).toBe(18_000);
    expect(row.beginningBasis).toBe(5_000);
    expect(row.endingBasis).toBe(23_000); // 5k + 18k retained
  });

  it("C-corp: retained earnings do NOT increase endingBasis (corp-level retention)", () => {
    const ccorp = {
      id: "cc-1",
      name: "BigCo",
      entityType: "c_corp" as const,
      trustSubType: null,
      isGrantor: false,
      initialValue: 0,
      initialBasis: 5_000,
    };
    const y = makeYear(2026);
    y.accountLedgers = {
      "cc-cash": { beginningValue: 0, endingValue: 60_000, growth: 0, contributions: 80_000, distributions: 20_000, internalContributions: 0, internalDistributions: 0, rmdAmount: 0, fees: 0, entries: [
        { category: "income",  label: "Income",  amount:  80_000, sourceId: "biz-inc" },
        { category: "expense", label: "Expense", amount: -20_000, sourceId: "biz-exp" },
      ] } as never,
    };
    const incomes: Income[] = [
      { id: "biz-inc", type: "business", name: "Op", annualAmount: 80_000, startYear: 2026, endYear: 2055, growthRate: 0, owner: "client", ownerEntityId: "cc-1" } as never,
    ];
    const expenses: Expense[] = [
      { id: "biz-exp", type: "other", name: "Op", annualAmount: 20_000, startYear: 2026, endYear: 2055, growthRate: 0, ownerEntityId: "cc-1" } as never,
    ];
    computeEntityCashFlow({
      years: [y],
      entitiesById: new Map([["cc-1", ccorp]]),
      ...ownersFrom(new Map([["cc-cash", { entityId: "cc-1", percent: 1 }]])),
      giftsByEntityYear: new Map(),
      incomes,
      expenses,
      entityFlowOverrides: [],
    });
    const row = y.entityCashFlow.get("cc-1")!;
    if (row.kind !== "business") throw new Error("expected business row");
    expect(row.retainedEarnings).toBe(60_000);
    expect(row.beginningBasis).toBe(5_000);
    expect(row.endingBasis).toBe(5_000); // flat — C-corp retention doesn't flow to shareholder basis
  });

  it("compounds business flat value at valueGrowthRate starting in year 1", () => {
    const llc = {
      id: "llc-1",
      name: "Smith Holdings",
      entityType: "llc" as const,
      trustSubType: null,
      isGrantor: false,
      initialValue: 1_000_000,
      initialBasis: 0,
      valueGrowthRate: 0.05,
    };
    const years = [makeYear(2026), makeYear(2027), makeYear(2028)];
    computeEntityCashFlow({
      years,
      entitiesById: new Map([["llc-1", llc]]),
      ...ownersFrom(new Map()),
      giftsByEntityYear: new Map(),
      incomes: [],
      expenses: [],
      entityFlowOverrides: [],
    });

    const r0 = years[0].entityCashFlow.get("llc-1")!;
    const r1 = years[1].entityCashFlow.get("llc-1")!;
    const r2 = years[2].entityCashFlow.get("llc-1")!;
    if (r0.kind !== "business" || r1.kind !== "business" || r2.kind !== "business") {
      throw new Error("expected business rows");
    }

    // Year 1 (planStart): BoY = initialValue, grows by 5% during the year.
    expect(r0.beginningTotalValue).toBe(1_000_000);
    expect(r0.growth).toBeCloseTo(50_000, 6);
    expect(r0.endingTotalValue).toBeCloseTo(1_050_000, 6);

    // Year 2: BoY matches Y1 ending; grows by 1,050,000 * 5% = 52,500.
    expect(r1.beginningTotalValue).toBeCloseTo(1_050_000, 6);
    expect(r1.growth).toBeCloseTo(52_500, 6);
    expect(r1.endingTotalValue).toBeCloseTo(1_102_500, 6);

    // Year 3: BoY matches Y2 ending; grows by 1,102,500 * 5% = 55,125.
    expect(r2.beginningTotalValue).toBeCloseTo(1_102_500, 6);
    expect(r2.growth).toBeCloseTo(55_125, 6);
    expect(r2.endingTotalValue).toBeCloseTo(1_157_625, 6);
  });

  it("schedule mode: business income/expense come from override scalars even without base rows", () => {
    const llc = {
      id: "llc-1",
      name: "Schedule LLC",
      entityType: "llc" as const,
      trustSubType: null,
      isGrantor: false,
      initialValue: 0,
      initialBasis: 0,
      flowMode: "schedule" as const,
    };
    const y = makeYear(2026);
    computeEntityCashFlow({
      years: [y],
      entitiesById: new Map([["llc-1", llc]]),
      ...ownersFrom(new Map()),
      giftsByEntityYear: new Map(),
      // No base rows — schedule grid is the source of truth.
      incomes: [],
      expenses: [],
      entityFlowOverrides: [
        { entityId: "llc-1", year: 2026, incomeAmount: 10_000, expenseAmount: 1_000, distributionPercent: 1 },
      ],
    });
    const row = y.entityCashFlow.get("llc-1")!;
    if (row.kind !== "business") throw new Error("expected business row");
    expect(row.income).toBe(10_000);
    expect(row.expenses).toBe(1_000);
  });

  it("treats null valueGrowthRate as 0 — flat value stays constant year over year", () => {
    const llc = {
      id: "llc-1",
      name: "Static Co",
      entityType: "llc" as const,
      trustSubType: null,
      isGrantor: false,
      initialValue: 750_000,
      initialBasis: 0,
      valueGrowthRate: null,
    };
    const years = [makeYear(2026), makeYear(2027), makeYear(2028)];
    computeEntityCashFlow({
      years,
      entitiesById: new Map([["llc-1", llc]]),
      ...ownersFrom(new Map()),
      giftsByEntityYear: new Map(),
      incomes: [],
      expenses: [],
      entityFlowOverrides: [],
    });
    for (const y of years) {
      const row = y.entityCashFlow.get("llc-1")!;
      if (row.kind !== "business") throw new Error("expected business row");
      expect(row.beginningTotalValue).toBe(750_000);
      expect(row.growth).toBe(0);
      expect(row.endingTotalValue).toBe(750_000);
    }
  });

  it("locks the entity share on split-owned accounts so household drains don't bleed into it", () => {
    const year = makeYear(2026);
    year.accountLedgers["acct-split"] = {
      beginningValue: 100_000,
      endingValue: 80_000, // household drained $20k from the account
      growth: 0,
      contributions: 0,
      distributions: 20_000,
      internalContributions: 0,
      internalDistributions: 0,
      rmdAmount: 0,
      fees: 0,
      entries: [],
    };

    const entitiesById = new Map<string, EntityMetadata>([
      [
        "ent-biz",
        {
          id: "ent-biz",
          name: "Acme LLC",
          entityType: "llc",
          trustSubType: null,
          isGrantor: false,
          initialValue: 0,
          initialBasis: 0,
          valueGrowthRate: 0,
        },
      ],
    ]);

    const accountEntityOwners = new Map<string, { entityId: string; percent: number }>([
      ["acct-split", { entityId: "ent-biz", percent: 0.2 }],
    ]);

    computeEntityCashFlow({
      years: [year],
      entitiesById,
      ...ownersFrom(accountEntityOwners),
      giftsByEntityYear: new Map(),
      incomes: [],
      expenses: [],
      entityFlowOverrides: [],
    });

    const row = year.entityCashFlow.get("ent-biz");
    if (row?.kind !== "business") throw new Error("expected business row");
    expect(row.beginningTotalValue).toBeCloseTo(20_000, 2); // locked at 20% × $100k BoY
    expect(row.growth).toBeCloseTo(0, 2);
    // No retained earnings (no income/expenses), so EoY = BoY + growth = $20k
    // (NOT 20% × $80k = $16k as a naive proportional rollup would give)
    expect(row.endingTotalValue).toBeCloseTo(20_000, 2);
  });

  it("carries the locked entity share across years on split-owned accounts", () => {
    const y1 = makeYear(2026);
    y1.accountLedgers["acct-split"] = {
      beginningValue: 100_000,
      endingValue: 90_000, // year 1 household drain $10k
      growth: 0,
      contributions: 0,
      distributions: 10_000,
      internalContributions: 0,
      internalDistributions: 0,
      rmdAmount: 0,
      fees: 0,
      entries: [],
    };
    const y2 = makeYear(2027);
    y2.accountLedgers["acct-split"] = {
      beginningValue: 90_000, // carries from y1 EoY
      endingValue: 85_000, // year 2 drain $5k
      growth: 0,
      contributions: 0,
      distributions: 5_000,
      internalContributions: 0,
      internalDistributions: 0,
      rmdAmount: 0,
      fees: 0,
      entries: [],
    };

    const entitiesById = new Map<string, EntityMetadata>([
      [
        "ent-biz",
        {
          id: "ent-biz",
          name: "Acme LLC",
          entityType: "llc",
          trustSubType: null,
          isGrantor: false,
          initialValue: 0,
          initialBasis: 0,
          valueGrowthRate: 0,
        },
      ],
    ]);

    const accountEntityOwners = new Map<string, { entityId: string; percent: number }>([
      ["acct-split", { entityId: "ent-biz", percent: 0.2 }],
    ]);

    computeEntityCashFlow({
      years: [y1, y2],
      entitiesById,
      ...ownersFrom(accountEntityOwners),
      giftsByEntityYear: new Map(),
      incomes: [],
      expenses: [],
      entityFlowOverrides: [],
    });

    const r1 = y1.entityCashFlow.get("ent-biz");
    if (r1?.kind !== "business") throw new Error("expected business row y1");
    expect(r1.beginningTotalValue).toBeCloseTo(20_000, 2);
    expect(r1.endingTotalValue).toBeCloseTo(20_000, 2);

    const r2 = y2.entityCashFlow.get("ent-biz");
    if (r2?.kind !== "business") throw new Error("expected business row y2");
    expect(r2.beginningTotalValue).toBeCloseTo(20_000, 2); // carried, not 20% × $90k = $18k
    expect(r2.endingTotalValue).toBeCloseTo(20_000, 2);
  });

  it("rolls in account values proportionally for split entity/personal ownership", () => {
    const year = makeYear(2026);
    year.accountLedgers["acct-split"] = {
      beginningValue: 100_000,
      endingValue: 105_000,
      growth: 5_000,
      contributions: 0,
      distributions: 0,
      internalContributions: 0,
      internalDistributions: 0,
      rmdAmount: 0,
      fees: 0,
      entries: [],
    };

    const entitiesById = new Map<string, EntityMetadata>([
      [
        "ent-biz",
        {
          id: "ent-biz",
          name: "Acme LLC",
          entityType: "llc",
          trustSubType: null,
          isGrantor: false,
          initialValue: 0,
          initialBasis: 0,
          valueGrowthRate: 0,
        },
      ],
    ]);

    const accountEntityOwners = new Map<string, { entityId: string; percent: number }>([
      ["acct-split", { entityId: "ent-biz", percent: 0.6 }],
    ]);

    computeEntityCashFlow({
      years: [year],
      entitiesById,
      ...ownersFrom(accountEntityOwners),
      giftsByEntityYear: new Map(),
      incomes: [],
      expenses: [],
      entityFlowOverrides: [],
    });

    const row = year.entityCashFlow.get("ent-biz");
    expect(row?.kind).toBe("business");
    if (row?.kind !== "business") return;
    expect(row.beginningTotalValue).toBeCloseTo(60_000, 2);
    expect(row.growth).toBeCloseTo(3_000, 2);
    expect(row.endingTotalValue).toBeCloseTo(63_000, 2);
  });
});

describe("entity cash flow — an account gifted into a trust mid-horizon", () => {
  const trustMeta = (id: string): EntityMetadata => ({
    id,
    name: id,
    entityType: "trust",
    trustSubType: "irrevocable",
    isGrantor: false,
    initialValue: 0,
    initialBasis: 0,
  });
  type Owners = Array<{ entityId: string; percent: number }>;
  /** Years whose `acc-1` ledger is flat at `value` — no growth, no flows
   *  unless `entries` are given. */
  const flatYears = (yrs: number[], value: number, entries: ProjectionYear["accountLedgers"][string]["entries"] = []) =>
    yrs.map((y) => {
      const year = makeYear(y);
      year.accountLedgers["acc-1"] = {
        beginningValue: value,
        endingValue: value,
        growth: 0,
        contributions: 0,
        distributions: 0,
        internalContributions: 0,
        internalDistributions: 0,
        rmdAmount: 0,
        fees: 0,
        entries,
      };
      return year;
    });
  const run = (
    years: ProjectionYear[],
    accountEntityOwnersAt: (id: string, y: number) => Owners,
    entityIds: string[] = ["trust-1"],
  ) =>
    computeEntityCashFlow({
      years,
      entitiesById: new Map(entityIds.map((id) => [id, trustMeta(id)])),
      accountEntityOwnersAt,
      candidateAccountIds: ["acc-1"],
      giftsByEntityYear: new Map(),
      incomes: [],
      expenses: [],
      entityFlowOverrides: [],
    });
  const trust1 = (percent: number): Owners => [{ entityId: "trust-1", percent }];

  it("reports $0 before the gift year and the gifted share after", () => {
    // The headline defect: the balance sheet showed the trust holding this
    // account while the trust's own cash-flow page showed $0, because the
    // owner map was built once from the AUTHORED owners.
    const years = flatYears([2026, 2027, 2028], 1_000_000);
    run(years, (id, y) => (id === "acc-1" && y >= 2027 ? trust1(0.15) : []));
    expect(trustRow(years[0], "trust-1").endingBalance).toBe(0);
    expect(trustRow(years[1], "trust-1").endingBalance).toBeCloseTo(150_000, 2);
    expect(trustRow(years[2], "trust-1").endingBalance).toBeCloseTo(150_000, 2);
    // A split (<100%) share is also published for the balance sheet — from the
    // gift year on, and never before it.
    expect(years[0].entityAccountSharesEoY?.get("trust-1")?.get("acc-1")).toBeUndefined();
    expect(years[1].entityAccountSharesEoY?.get("trust-1")?.get("acc-1")).toBeCloseTo(150_000, 2);
    expect(years[2].entityAccountSharesEoY?.get("trust-1")?.get("acc-1")).toBeCloseTo(150_000, 2);
  });

  it("visits an account the entity owns in NO year of the authored baseline", () => {
    // accountsByEntity must be built from the union across years, or a
    // mid-horizon gift's account is never even looked at. 100% → the
    // full-ownership branch.
    const years = flatYears([2026, 2027], 500_000);
    run(years, (id, y) => (id === "acc-1" && y === 2027 ? trust1(1) : []));
    expect(trustRow(years[0], "trust-1").endingBalance).toBe(0);
    expect(trustRow(years[1], "trust-1").endingBalance).toBeCloseTo(500_000, 2);
  });

  it("treats an account absent from THIS year's map as 0%, not 100%", () => {
    // The `?? 1` default was unreachable before and is reachable now.
    const years = flatYears([2026, 2027], 800_000);
    run(years, (id, y) => (id === "acc-1" && y === 2027 ? trust1(0.4) : []));
    expect(trustRow(years[0], "trust-1").endingBalance).toBe(0);
    expect(trustRow(years[1], "trust-1").endingBalance).toBeCloseTo(320_000, 2);
  });

  it("books a SECOND partial gift on top of the first, not just the first", () => {
    // 15% in 2027, another 15% in 2029. The locked carry used to win outright,
    // holding the trust at $150k forever while the snapshot said 30%.
    const years = flatYears([2026, 2027, 2028, 2029, 2030], 1_000_000);
    run(years, (_id, y) => (y >= 2029 ? trust1(0.3) : y >= 2027 ? trust1(0.15) : []));
    const ending = years.map((y) => trustRow(y, "trust-1").endingBalance);
    expect(ending).toEqual([0, 150_000, 150_000, 300_000, 300_000]);
    expect(years[3].entityAccountSharesEoY?.get("trust-1")?.get("acc-1")).toBeCloseTo(300_000, 2);
  });

  it("books each of two entities that share an account at its own percent", () => {
    // trust-1 owns 40% all along; trust-2 receives 20% in 2027. Each entity
    // reads its OWN row, never the other's.
    const years = flatYears([2026, 2027], 1_000_000);
    run(
      years,
      (_id, y) => [
        { entityId: "trust-1", percent: 0.4 },
        ...(y >= 2027 ? [{ entityId: "trust-2", percent: 0.2 }] : []),
      ],
      ["trust-1", "trust-2"],
    );
    expect(trustRow(years[0], "trust-1").endingBalance).toBeCloseTo(400_000, 2);
    expect(trustRow(years[0], "trust-2").endingBalance).toBe(0);
    expect(trustRow(years[1], "trust-1").endingBalance).toBeCloseTo(400_000, 2);
    expect(trustRow(years[1], "trust-2").endingBalance).toBeCloseTo(200_000, 2);
  });

  it("treats a gift-composed share a hair under 1 as full ownership", () => {
    // Summed gift percents can land at 0.9999999…; an exact `=== 1` sent that
    // into the split branch, which drops the account's income and expenses.
    const years = flatYears([2026], 500_000, [
      { category: "income", label: "Dividends", amount: 12_000, sourceId: "div" },
    ]);
    run(years, () => trust1(1 - 1e-12));
    const row = trustRow(years[0], "trust-1");
    expect(row.income).toBeCloseTo(12_000, 2);
    expect(row.endingBalance).toBeCloseTo(500_000, 2);
    expect(years[0].entityAccountSharesEoY?.get("trust-1")?.get("acc-1")).toBeUndefined();
  });

  it("publishes each year's entity → account → percent on entityAccountOwners, from the gift year on", () => {
    // The report surfaces (trust drill-down, asset ledger) read this map
    // instead of the authored owners. Full AND split ownership both appear.
    for (const percent of [1, 0.4]) {
      const years = flatYears([2026, 2027, 2028], 500_000);
      run(years, (id, y) => (id === "acc-1" && y >= 2027 ? trust1(percent) : []));
      expect(years[0].entityAccountOwners?.get("trust-1")?.get("acc-1")).toBeUndefined();
      expect(years[1].entityAccountOwners?.get("trust-1")?.get("acc-1")).toBe(percent);
      expect(years[2].entityAccountOwners?.get("trust-1")?.get("acc-1")).toBe(percent);
    }
  });
});

// ── Integration: runProjection wires computeEntityCashFlow ──────────────────

describe("computeEntityCashFlow integration via runProjection", () => {
  // Minimal fixture mirroring projection.trust-distributions-surface.test.ts.
  // Goal: verify wiring — `entityCashFlow` is a populated Map on every year,
  // regardless of whether the household has any entities. The unit tests above
  // already cover the row-content logic.
  const planSettings: PlanSettings = {
    flatFederalRate: 0.24,
    flatStateRate: 0.05,
    inflationRate: 0.03,
    planStartYear: 2026,
    planEndYear: 2027,
  };
  const client = {
    firstName: "Alice",
    lastName: "Test",
    dateOfBirth: "1975-01-01",
    retirementAge: 65,
    planEndAge: 90,
    filingStatus: "married_joint" as const,
    spouseName: "Bob Test",
    spouseDob: "1975-06-01",
    spouseRetirementAge: 65,
  };
  const hhChecking: Account = {
    id: "hh-checking",
    name: "Household Checking",
    category: "cash",
    subType: "checking",
    titlingType: "jtwros",
    value: 100_000,
    basis: 100_000,
    growthRate: 0,
    rmdEnabled: false,
    owners: [
      { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
      { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
    ],
    isDefaultChecking: true,
  };
  const spouseFm: FamilyMember = {
    id: "fm-spouse",
    relationship: "other",
    role: "other",
    firstName: "Bob",
    lastName: "Test",
    dateOfBirth: "1975-06-01",
  };
  const TRUST_INCOME_2026 = [
    { from: 0,     to: 3300,  rate: 0.10 },
    { from: 3300,  to: 12000, rate: 0.24 },
    { from: 12000, to: 16250, rate: 0.35 },
    { from: 16250, to: null,  rate: 0.37 },
  ];
  const TRUST_CAP_GAINS_2026 = [
    { from: 0,     to: 3350,  rate: 0    },
    { from: 3350,  to: 16300, rate: 0.15 },
    { from: 16300, to: null,  rate: 0.20 },
  ];
  const taxYearRow: TaxYearParameters = {
    year: 2026,
    incomeBrackets: {
      married_joint:    [{ from: 0, to: null, rate: 0.10 }],
      single:           [{ from: 0, to: null, rate: 0.10 }],
      head_of_household:[{ from: 0, to: null, rate: 0.10 }],
      married_separate: [{ from: 0, to: null, rate: 0.10 }],
    },
    capGainsBrackets: {
      married_joint:    { zeroPctTop: 94050, fifteenPctTop: 583750 },
      single:           { zeroPctTop: 47025, fifteenPctTop: 518900 },
      head_of_household:{ zeroPctTop: 63000, fifteenPctTop: 551350 },
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
    rothPhaseout: { startMfj: null, endMfj: null, startSingle: null, endSingle: null },
    iraDeduct: { coveredStartMfj: null, coveredEndMfj: null, coveredStartSingle: null,
                 coveredEndSingle: null, spousalStartMfj: null, spousalEndMfj: null },
    studentLoan: { maxDeduction: null, startMfj: null, endMfj: null, startSingle: null, endSingle: null },
    ctc: { perChild: null, refundableMax: null, odcPerDependent: null },
    saversCredit: { mfj: [], single: [], hoh: [] },
    contribLimits: {
      ira401kElective: 23500,
      ira401kCatchup50: 7500,
      ira401kCatchup6063: 11250,
      iraTradLimit: 7000,
      iraCatchup50: 1000,
      simpleLimitRegular: 17000,
      simpleCatchup50: 4000,
      hsaLimitSelf: 4400,
      hsaLimitFamily: 8750,
      hsaCatchup55: 1000,
    },
  };

  it("populates entityCashFlow on every projection year (no entities)", () => {
    const data: ClientData = {
      client,
      accounts: [hhChecking],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings,
      familyMembers: [spouseFm],
      entities: [],
      taxYearRows: [taxYearRow],
      giftEvents: [],
    };
    const years = runProjection(data);
    expect(years).toHaveLength(2);
    for (const y of years) {
      expect(y.entityCashFlow).toBeInstanceOf(Map);
      // No entities → empty map, but the field must still exist.
      expect(y.entityCashFlow.size).toBe(0);
    }
  });

  it("holds the trust row identity through a CRT termination payout", () => {
    const data = buildCrtLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 2,
      inceptionValue: 1_000_000,
      trailingYears: 1,
    });
    const years = runProjection(data);
    // 2028 is the year after the last payment: the corpus goes to the charity.
    const y2028 = years.find((y) => y.year === 2028)!;
    const row = trustRow(y2028, CRT_FIXTURE_IDS.CRT_ENTITY_ID);
    expect(row.totalDistributions).toBeGreaterThan(0);
    expect(row.endingBalance).toBeCloseTo(0, 2);
    expect(rowIdentityGap(row)).toBeCloseTo(0, 2);
  });

  /** Married household + one non-grantor trust paying a $25k fixed
   *  distribution to the spouse out of `trustAccounts`. */
  const fixedDistributionScenario = (trustAccounts: Account[]): ClientData => ({
    client,
    accounts: [hhChecking, ...trustAccounts],
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings,
    familyMembers: [spouseFm],
    entities: [
      {
        id: "t1",
        name: "Family Trust",
        includeInPortfolio: true,
        isGrantor: false,
        entityType: "trust",
        isIrrevocable: true,
        grantor: "client",
        distributionMode: "fixed",
        distributionAmount: 25_000,
        distributionPercent: null,
        incomeBeneficiaries: [
          { familyMemberId: "fm-spouse", householdRole: "spouse", percentage: 100 },
        ],
      },
    ],
    taxYearRows: [taxYearRow],
    giftEvents: [],
  });
  const trustChecking = (value: number): Account => ({
    id: "t1-checking",
    name: "Trust Checking",
    category: "cash",
    subType: "checking",
    titlingType: "jtwros",
    value,
    basis: value,
    growthRate: 0,
    rmdEnabled: false,
    owners: [{ kind: "entity", entityId: "t1", percent: 1 }],
    isDefaultChecking: true,
  });

  it("holds the trust row identity through a non-grantor fixed distribution", () => {
    const row = trustRow(runProjection(fixedDistributionScenario([trustChecking(200_000)]))[0], "t1");
    expect(row.totalDistributions).toBe(25_000);
    expect(row.endingBalance).toBeCloseTo(175_000, 2);
    expect(rowIdentityGap(row)).toBeCloseTo(0, 2);
  });

  it("reports the whole distribution, not just the cash slice, when it taps the trust's brokerage", () => {
    // $10k cash + $100k brokerage; the $25k distribution draws $10k from cash
    // and $15k from the brokerage (the gap-fill refill is an internal
    // transfer). The row must show all $25k as distributed.
    const trustBrokerage: Account = {
      id: "t1-brokerage",
      name: "Trust Brokerage",
      category: "taxable",
      subType: "brokerage",
      titlingType: "jtwros",
      value: 100_000,
      basis: 100_000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "entity", entityId: "t1", percent: 1 }],
    };
    const row = trustRow(
      runProjection(fixedDistributionScenario([trustChecking(10_000), trustBrokerage]))[0],
      "t1",
    );
    expect(row.totalDistributions).toBe(25_000);
    expect(row.endingBalance).toBeCloseTo(85_000, 2);
    expect(rowIdentityGap(row)).toBeCloseTo(0, 2);
  });

  /** Married household + one non-grantor trust with no distribution policy,
   *  receiving asset gifts. Every account is flat (0% growth, no flows). */
  const giftScenario = (
    accounts: Account[],
    giftEvents: ClientData["giftEvents"],
    planEndYear = planSettings.planEndYear,
  ): ClientData => ({
    client,
    accounts: [hhChecking, ...accounts],
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: { ...planSettings, planEndYear },
    familyMembers: [spouseFm],
    entities: [
      {
        id: "t-other",
        name: "Other Trust",
        includeInPortfolio: false,
        isGrantor: false,
        entityType: "trust",
        isIrrevocable: true,
        grantor: "client",
      },
      {
        id: "t-gift",
        name: "Gift Trust",
        includeInPortfolio: false,
        isGrantor: false,
        entityType: "trust",
        isIrrevocable: true,
        grantor: "client",
      },
    ],
    taxYearRows: [taxYearRow],
    giftEvents,
  });
  const clientBrokerage = (id: string, value: number, owners?: Account["owners"]): Account => ({
    id,
    name: id,
    category: "taxable",
    subType: "brokerage",
    titlingType: "jtwros",
    value,
    basis: value,
    growthRate: 0,
    rmdEnabled: false,
    owners: owners ?? [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  });

  it("books an account gifted into a trust mid-horizon to the trust's row from the gift year", () => {
    // WIRING PIN for the projection's per-year resolver. The unit tests above
    // stub the resolver and cannot see projection.ts; this one can. A 30% gift
    // (split branch) and a 100% gift (full branch), both landing in 2027.
    const years = runProjection(
      giftScenario(
        [clientBrokerage("acc-part", 1_000_000), clientBrokerage("acc-whole", 200_000)],
        [
          { kind: "asset", year: 2027, accountId: "acc-part", percent: 0.3, grantor: "client", recipientEntityId: "t-gift" },
          { kind: "asset", year: 2027, accountId: "acc-whole", percent: 1, grantor: "client", recipientEntityId: "t-gift" },
        ],
      ),
    );
    const [y2026, y2027] = years;
    expect(trustRow(y2026, "t-gift").endingBalance).toBe(0);
    expect(trustRow(y2027, "t-gift").endingBalance).toBeCloseTo(500_000, 2);
    expect(y2026.entityAccountSharesEoY?.get("t-gift")?.get("acc-part")).toBeUndefined();
    expect(y2027.entityAccountSharesEoY?.get("t-gift")?.get("acc-part")).toBeCloseTo(300_000, 2);
  });

  it("books a second partial gift of the same account on top of the first", () => {
    // 15% in 2027 + 15% in 2029 on a flat $1M account. The locked carry used to
    // hold the trust at $150k after the second gift.
    const years = runProjection(
      giftScenario(
        [clientBrokerage("acc-part", 1_000_000)],
        [
          { kind: "asset", year: 2027, accountId: "acc-part", percent: 0.15, grantor: "client", recipientEntityId: "t-gift" },
          { kind: "asset", year: 2029, accountId: "acc-part", percent: 0.15, grantor: "client", recipientEntityId: "t-gift" },
        ],
        2030,
      ),
    );
    expect(years.map((y) => trustRow(y, "t-gift").endingBalance)).toEqual([
      0, 150_000, 150_000, 300_000, 300_000,
    ]);
  });

  it("books a gift to a second trust on an account a first trust already part-owns", () => {
    // t-other owns 40% as authored; t-gift receives 20% in 2027. The resolver
    // used to hand back only the FIRST entity row, so t-gift read $0.
    const years = runProjection(
      giftScenario(
        [
          clientBrokerage("acc-shared", 1_000_000, [
            { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.6 },
            { kind: "entity", entityId: "t-other", percent: 0.4 },
          ]),
        ],
        [{ kind: "asset", year: 2027, accountId: "acc-shared", percent: 0.2, grantor: "client", recipientEntityId: "t-gift" }],
      ),
    );
    const [y2026, y2027] = years;
    expect(trustRow(y2026, "t-other").endingBalance).toBeCloseTo(400_000, 2);
    expect(trustRow(y2026, "t-gift").endingBalance).toBe(0);
    expect(trustRow(y2027, "t-other").endingBalance).toBeCloseTo(400_000, 2);
    expect(trustRow(y2027, "t-gift").endingBalance).toBeCloseTo(200_000, 2);
  });

  it("does not re-apply an asset gift dated before planStartYear on top of the authored rows", () => {
    // The authored owners already carry the 2025 gift (80/20). Applying it
    // again would book 36% or 40% to the trust instead of 20%.
    const years = runProjection(
      giftScenario(
        [
          clientBrokerage("acc-pre", 500_000, [
            { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.8 },
            { kind: "entity", entityId: "t-gift", percent: 0.2 },
          ]),
        ],
        [{ kind: "asset", year: 2025, accountId: "acc-pre", percent: 0.2, grantor: "client", recipientEntityId: "t-gift" }],
      ),
    );
    for (const y of years) expect(trustRow(y, "t-gift").endingBalance).toBeCloseTo(100_000, 2);
  });
});

describe("computeBusinessAccountCashFlow", () => {
  function makeBizAccount(overrides: Partial<Account> = {}): Account {
    return {
      id: "biz-acct",
      name: "Acme LLC",
      category: "business",
      subType: "other",
      value: 1_000_000,
      basis: 200_000,
      rothValue: 0,
      growthSource: "default",
      growthRate: 0.05,
      turnoverPct: 0,
      annualPropertyTax: 0,
      propertyTaxGrowthRate: 0,
      propertyTaxGrowthSource: "default",
      rmdEnabled: false,
      isDefaultChecking: false,
      titlingType: "jtwros",
      owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
      parentAccountId: null,
      businessType: "llc",
      distributionPolicyPercent: 0.6,
      flowMode: "annual",
      businessTaxTreatment: "qbi",
      ...overrides,
    } as Account;
  }

  it("emits a business row keyed by accountId, sourced from ledgers + computeBusinessYearFlow", () => {
    const biz = makeBizAccount();
    const y = makeYear(2026);
    // Business account's own ledger holds the equity valuation walk.
    y.accountLedgers = {
      "biz-acct": {
        beginningValue: 1_000_000,
        endingValue: 1_050_000,
        growth: 50_000,
        contributions: 0,
        distributions: 0,
        internalContributions: 0,
        internalDistributions: 0,
        rmdAmount: 0,
        fees: 0,
        entries: [],
      } as never,
    };
    y.accountBasisBoY = { "biz-acct": 200_000 };

    // Income/expense rows tagged with ownerAccountId — same shape the engine
    // consumes in computeBusinessYearFlow.
    const incomes: Income[] = [
      {
        id: "biz-rev",
        type: "business",
        name: "Operating revenue",
        annualAmount: 400_000,
        startYear: 2026,
        endYear: 2055,
        growthRate: 0,
        owner: "client",
        ownerAccountId: "biz-acct",
      } as never,
    ];
    const expenses: Expense[] = [
      {
        id: "biz-exp",
        type: "other",
        name: "Operating cost",
        annualAmount: 100_000,
        startYear: 2026,
        endYear: 2055,
        growthRate: 0,
        ownerAccountId: "biz-acct",
      } as never,
    ];

    const businessAccountsById = new Map<string, BusinessAccountMetadata>([
      ["biz-acct", { id: biz.id, name: biz.name, businessType: "llc", flowMode: "annual", distributionPolicyPercent: 0.6 }],
    ]);
    computeBusinessAccountCashFlow({
      years: [y],
      businessAccountsById,
      accounts: [biz],
      incomes,
      expenses,
      accountFlowOverrides: [],
    });

    const row = y.entityCashFlow.get("biz-acct");
    expect(row?.kind).toBe("business");
    if (row?.kind !== "business") return;
    expect(row.entityType).toBe("llc");
    expect(row.beginningTotalValue).toBe(1_000_000);
    expect(row.endingTotalValue).toBe(1_050_000);
    expect(row.growth).toBe(50_000);
    expect(row.income).toBe(400_000);
    expect(row.expenses).toBe(100_000);
    // netIncome = 300k, distPercent = 0.6 → distribution = 180k.
    expect(row.annualDistribution).toBe(180_000);
    // retainedEarnings = 300k − 180k = 120k.
    expect(row.retainedEarnings).toBe(120_000);
    // LLC is pass-through → basis grows by retained earnings.
    expect(row.beginningBasis).toBe(200_000);
    expect(row.endingBasis).toBe(320_000);
  });

  it("rolls up child accounts in the business tree into consolidated value/growth/basis", () => {
    const biz = makeBizAccount({ id: "biz-1", name: "Holdco" });
    const childCash: Account = {
      ...makeBizAccount(),
      id: "biz-1-cash",
      name: "Holdco Cash",
      category: "cash",
      subType: "checking",
      businessType: null,
      parentAccountId: "biz-1",
      isDefaultChecking: true,
    };
    const y = makeYear(2026);
    y.accountLedgers = {
      "biz-1": {
        beginningValue: 500_000,
        endingValue: 525_000,
        growth: 25_000,
        contributions: 0,
        distributions: 0,
        internalContributions: 0,
        internalDistributions: 0,
        rmdAmount: 0,
        fees: 0,
        entries: [],
      } as never,
      "biz-1-cash": {
        beginningValue: 75_000,
        endingValue: 80_000,
        growth: 5_000,
        contributions: 0,
        distributions: 0,
        internalContributions: 0,
        internalDistributions: 0,
        rmdAmount: 0,
        fees: 0,
        entries: [],
      } as never,
    };
    y.accountBasisBoY = { "biz-1": 150_000, "biz-1-cash": 75_000 };

    const businessAccountsById = new Map<string, BusinessAccountMetadata>([
      ["biz-1", { id: biz.id, name: biz.name, businessType: "llc", flowMode: "annual", distributionPolicyPercent: 1.0 }],
    ]);
    computeBusinessAccountCashFlow({
      years: [y],
      businessAccountsById,
      accounts: [biz, childCash],
      incomes: [],
      expenses: [],
      accountFlowOverrides: [],
    });

    const row = y.entityCashFlow.get("biz-1");
    if (row?.kind !== "business") throw new Error("expected business row");
    // Parent (500k) + child cash (75k) = 575k BoY.
    expect(row.beginningTotalValue).toBe(575_000);
    // Parent (525k) + child cash (80k) = 605k EoY.
    expect(row.endingTotalValue).toBe(605_000);
    // 25k + 5k = 30k consolidated growth.
    expect(row.growth).toBe(30_000);
    // 150k + 75k = 225k consolidated BoY basis.
    expect(row.beginningBasis).toBe(225_000);
  });

  it("schedule mode reads income/expense/distPercent from accountFlowOverrides", () => {
    const biz = makeBizAccount({ flowMode: "schedule", distributionPolicyPercent: null });
    const y = makeYear(2026);
    y.accountLedgers = {
      "biz-acct": {
        beginningValue: 1_000_000,
        endingValue: 1_000_000,
        growth: 0,
        contributions: 0,
        distributions: 0,
        internalContributions: 0,
        internalDistributions: 0,
        rmdAmount: 0,
        fees: 0,
        entries: [],
      } as never,
    };
    const businessAccountsById = new Map<string, BusinessAccountMetadata>([
      ["biz-acct", { id: biz.id, name: biz.name, businessType: "llc", flowMode: "schedule", distributionPolicyPercent: null }],
    ]);
    computeBusinessAccountCashFlow({
      years: [y],
      businessAccountsById,
      accounts: [biz],
      // Base income/expense rows are NOT consulted in schedule mode — the
      // grid cell is the source of truth.
      incomes: [
        { id: "ignored", type: "business", name: "Ignored", annualAmount: 999_999, startYear: 2026, endYear: 2055, growthRate: 0, owner: "client", ownerAccountId: "biz-acct" } as never,
      ],
      expenses: [],
      accountFlowOverrides: [
        { accountId: "biz-acct", year: 2026, incomeAmount: 600_000, expenseAmount: 150_000, distributionPercent: 0.5 } as never,
      ],
    });

    const row = y.entityCashFlow.get("biz-acct");
    if (row?.kind !== "business") throw new Error("expected business row");
    expect(row.income).toBe(600_000);
    expect(row.expenses).toBe(150_000);
    // netIncome = 450k, distPercent = 0.5 → distribution = 225k.
    expect(row.annualDistribution).toBe(225_000);
  });

  it("c_corp does NOT pass retained earnings into ending basis", () => {
    const biz = makeBizAccount({ businessType: "c_corp", distributionPolicyPercent: 0 });
    const y = makeYear(2026);
    y.accountLedgers = {
      "biz-acct": {
        beginningValue: 1_000_000,
        endingValue: 1_000_000,
        growth: 0,
        contributions: 0,
        distributions: 0,
        internalContributions: 0,
        internalDistributions: 0,
        rmdAmount: 0,
        fees: 0,
        entries: [],
      } as never,
    };
    y.accountBasisBoY = { "biz-acct": 100_000 };
    const incomes: Income[] = [
      { id: "rev", type: "business", name: "Rev", annualAmount: 50_000, startYear: 2026, endYear: 2055, growthRate: 0, owner: "client", ownerAccountId: "biz-acct" } as never,
    ];
    const businessAccountsById = new Map<string, BusinessAccountMetadata>([
      ["biz-acct", { id: biz.id, name: biz.name, businessType: "c_corp", flowMode: "annual", distributionPolicyPercent: 0 }],
    ]);
    computeBusinessAccountCashFlow({
      years: [y],
      businessAccountsById,
      accounts: [biz],
      incomes,
      expenses: [],
      accountFlowOverrides: [],
    });

    const row = y.entityCashFlow.get("biz-acct");
    if (row?.kind !== "business") throw new Error("expected business row");
    expect(row.entityType).toBe("c_corp");
    expect(row.retainedEarnings).toBe(50_000);
    // c_corp: basis flat regardless of retained earnings.
    expect(row.endingBasis).toBe(100_000);
  });

  it("emits zero rows when there are no top-level business accounts", () => {
    const y = makeYear(2026);
    computeBusinessAccountCashFlow({
      years: [y],
      businessAccountsById: new Map(),
      accounts: [],
      incomes: [],
      expenses: [],
      accountFlowOverrides: [],
    });
    expect(y.entityCashFlow.size).toBe(0);
  });
});

describe("buildEntityValueAtYear", () => {
  // Synthetic rows: only the fields the reader touches. The business values
  // differ by year so a reader keyed to the wrong year cannot pass, and the
  // trust row has no `endingTotalValue` so the kind branch is load-bearing.
  const years = [
    { year: 2026, entityCashFlow: new Map([
      ["biz-1", { kind: "business", endingTotalValue: 1_000_000 }],
    ]) },
    { year: 2027, entityCashFlow: new Map([
      ["biz-1", { kind: "business", endingTotalValue: 1_250_000 }],
      ["trust-1", { kind: "trust", endingBalance: 400_000 }],
    ]) },
  ] as unknown as ProjectionYear[];
  const valueAt = buildEntityValueAtYear(years);

  it("reads each year's own business endingTotalValue", () => {
    expect(valueAt("biz-1", 2026)).toBe(1_000_000);
    expect(valueAt("biz-1", 2027)).toBe(1_250_000);
  });

  it("reads a trust row's endingBalance", () => {
    expect(valueAt("trust-1", 2027)).toBe(400_000);
  });

  it("is 0 for an unknown entity or a year with no row", () => {
    expect(valueAt("nope", 2027)).toBe(0);
    expect(valueAt("trust-1", 2026)).toBe(0);
    expect(valueAt("biz-1", 2030)).toBe(0);
  });
});
