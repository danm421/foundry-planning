import { describe, it, expect } from "vitest";
import type {
  Account,
  ClientData,
  EntitySummary,
  ProjectionResult,
  ProjectionYear,
  HypotheticalEstateTax,
  EstateTaxResult,
} from "@/engine/types";
import { buildYearlyLiquidityReport } from "./yearly-liquidity-report";

const NAMES = { clientName: "Alice", spouseName: "Bob" };
const DOBS = { clientDob: "1960-01-01", spouseDob: "1962-01-01" };

function emptyClientData(): ClientData {
  return {
    client: {
      firstName: "Alice",
      lastName: "X",
      dateOfBirth: "1960-01-01",
      retirementAge: 65,
      planEndAge: 95,
      filingStatus: "married_joint",
      spouseName: "Bob",
      spouseDob: "1962-01-01",
      spouseRetirementAge: 65,
    },
    accounts: [],
    liabilities: [],
    incomes: [],
    expenses: [],
    familyMembers: [],
    entities: [],
    externalBeneficiaries: [],
    gifts: [],
    giftEvents: [],
    bequests: [],
    beneficiaryDesignations: [],
    planSettings: {
      planStartYear: 2026,
      inflationRate: 0.03,
    },
  } as unknown as ClientData;
}

function emptyProjection(): ProjectionResult {
  return {
    years: [],
    firstDeathEvent: null,
    secondDeathEvent: null,
    todayHypotheticalEstateTax: null,
  } as unknown as ProjectionResult;
}

describe("buildYearlyLiquidityReport", () => {
  it("returns empty rows and zero totals when projection has no years", () => {
    const report = buildYearlyLiquidityReport({
      projection: emptyProjection(),
      clientData: emptyClientData(),
      ownerNames: NAMES,
      ownerDobs: DOBS,
    });
    expect(report.rows).toEqual([]);
    expect(report.totals.totalInsuranceBenefit).toBe(0);
    expect(report.totals.totalPortfolioAssets).toBe(0);
    expect(report.totals.totalTransferCost).toBe(0);
    expect(report.totals.surplusDeficitWithPortfolio).toBe(0);
    expect(report.totals.surplusDeficitInsuranceOnly).toBe(0);
  });
});

function deathResult(opts: {
  decedent: "client" | "spouse";
  order: 1 | 2;
  totalTaxesAndExpenses: number;
  irdTax?: number;
}): EstateTaxResult {
  return {
    deceased: opts.decedent,
    deathOrder: opts.order,
    grossEstate: 0,
    taxableEstate: 0,
    charitableDeduction: 0,
    stateEstateTax: 0,
    estateAdminExpenses: 0,
    federalEstateTax: 0,
    totalTaxesAndExpenses: opts.totalTaxesAndExpenses,
    drainAttributions: opts.irdTax
      ? [{ drainKind: "ird_tax", amount: opts.irdTax, recipient: "x" }]
      : [],
  } as unknown as EstateTaxResult;
}

function projectionYear(opts: {
  year: number;
  hypothetical: HypotheticalEstateTax | null;
  ledgers?: Record<string, { endingValue: number }>;
}): ProjectionYear {
  return {
    year: opts.year,
    accountLedgers: opts.ledgers ?? {},
    hypotheticalEstateTax: opts.hypothetical ?? undefined,
  } as unknown as ProjectionYear;
}

function htMarried(opts: {
  firstTax: number;
  finalTax: number;
  firstIrd?: number;
  finalIrd?: number;
}): HypotheticalEstateTax {
  return {
    primaryFirst: {
      firstDecedent: "client",
      firstDeath: deathResult({
        decedent: "client",
        order: 1,
        totalTaxesAndExpenses: opts.firstTax,
        irdTax: opts.firstIrd,
      }),
      finalDeath: deathResult({
        decedent: "spouse",
        order: 2,
        totalTaxesAndExpenses: opts.finalTax,
        irdTax: opts.finalIrd,
      }),
      firstDeathTransfers: [],
      finalDeathTransfers: [],
      totals: { federal: 0, state: 0, admin: 0, total: 0 },
    },
  } as HypotheticalEstateTax;
}

describe("buildYearlyLiquidityReport — iteration", () => {
  it("emits one row per year that has hypotheticalEstateTax, skips others", () => {
    const projection = {
      years: [
        projectionYear({ year: 2026, hypothetical: htMarried({ firstTax: 100, finalTax: 200 }) }),
        projectionYear({ year: 2027, hypothetical: null }),
        projectionYear({ year: 2028, hypothetical: htMarried({ firstTax: 50, finalTax: 75 }) }),
      ],
    } as unknown as ProjectionResult;

    const report = buildYearlyLiquidityReport({
      projection,
      clientData: emptyClientData(),
      ownerNames: NAMES,
      ownerDobs: DOBS,
    });

    expect(report.rows.map((r) => r.year)).toEqual([2026, 2028]);
  });

  it("computes transfer cost = firstDeath taxes + IRD + finalDeath taxes + IRD", () => {
    const projection = {
      years: [
        projectionYear({
          year: 2026,
          hypothetical: htMarried({
            firstTax: 100_000,
            firstIrd: 25_000,
            finalTax: 200_000,
            finalIrd: 50_000,
          }),
        }),
      ],
    } as unknown as ProjectionResult;

    const report = buildYearlyLiquidityReport({
      projection,
      clientData: emptyClientData(),
      ownerNames: NAMES,
      ownerDobs: DOBS,
    });

    expect(report.rows[0].totalTransferCost).toBe(375_000);
    expect(report.totals.totalTransferCost).toBe(375_000);
  });

  it("resolves ages from DOBs (client + spouse for married)", () => {
    const projection = {
      years: [
        projectionYear({ year: 2026, hypothetical: htMarried({ firstTax: 0, finalTax: 0 }) }),
      ],
    } as unknown as ProjectionResult;
    const report = buildYearlyLiquidityReport({
      projection,
      clientData: emptyClientData(),
      ownerNames: NAMES,
      ownerDobs: DOBS,
    });
    expect(report.rows[0].ageClient).toBe(66);
    expect(report.rows[0].ageSpouse).toBe(64);
  });

  it("falls back to spouseFirst when primaryFirst is missing", () => {
    const ht = {
      primaryFirst: undefined,
      spouseFirst: {
        firstDecedent: "spouse",
        firstDeath: deathResult({
          decedent: "spouse",
          order: 1,
          totalTaxesAndExpenses: 999,
        }),
        firstDeathTransfers: [],
        totals: { federal: 0, state: 0, admin: 0, total: 0 },
      },
    } as unknown as HypotheticalEstateTax;

    const projection = {
      years: [projectionYear({ year: 2026, hypothetical: ht })],
    } as unknown as ProjectionResult;

    const report = buildYearlyLiquidityReport({
      projection,
      clientData: emptyClientData(),
      ownerNames: NAMES,
      ownerDobs: DOBS,
    });
    expect(report.rows[0].totalTransferCost).toBe(999);
  });
});

function whole(opts: {
  id: string;
  faceValue: number;
  owners: Account["owners"];
  insuredPerson?: "client" | "spouse" | "joint";
}): Account {
  return {
    id: opts.id,
    name: opts.id,
    category: "life_insurance",
    subType: "whole",
    value: 0,
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
    insuredPerson: opts.insuredPerson ?? "client",
    owners: opts.owners,
    lifeInsurance: {
      faceValue: opts.faceValue,
      costBasis: 0,
      premiumAmount: 0,
      premiumYears: null,
      policyType: "whole",
      termIssueYear: null,
      termLengthYears: null,
      endsAtInsuredRetirement: false,
      cashValueGrowthMode: "basic",
      postPayoutMergeAccountId: null,
      postPayoutGrowthRate: 0,
      cashValueSchedule: [],
    },
  };
}

function term(opts: {
  id: string;
  faceValue: number;
  owners: Account["owners"];
  termIssueYear: number;
  termLengthYears: number;
  insuredPerson?: "client" | "spouse" | "joint";
}): Account {
  return {
    ...whole({
      id: opts.id,
      faceValue: opts.faceValue,
      owners: opts.owners,
      insuredPerson: opts.insuredPerson,
    }),
    subType: "term",
    lifeInsurance: {
      ...whole({
        id: opts.id,
        faceValue: opts.faceValue,
        owners: opts.owners,
      }).lifeInsurance!,
      policyType: "term",
      termIssueYear: opts.termIssueYear,
      termLengthYears: opts.termLengthYears,
    },
  };
}

const ILIT: EntitySummary = {
  id: "ilit-1",
  name: "Cooper ILIT",
  entityType: "trust",
  isIrrevocable: true,
} as unknown as EntitySummary;

describe("buildYearlyLiquidityReport — insurance allocation", () => {
  it("family-owned policy goes fully to insuranceInEstate", () => {
    const data = emptyClientData();
    data.accounts = [
      whole({
        id: "p1",
        faceValue: 1_000_000,
        owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
      }),
    ];
    const projection = {
      years: [projectionYear({ year: 2026, hypothetical: htMarried({ firstTax: 0, finalTax: 0 }) })],
    } as unknown as ProjectionResult;

    const report = buildYearlyLiquidityReport({
      projection,
      clientData: data,
      ownerNames: NAMES,
      ownerDobs: DOBS,
    });
    expect(report.rows[0].insuranceInEstate).toBe(1_000_000);
    expect(report.rows[0].insuranceOutOfEstate).toBe(0);
    expect(report.rows[0].totalInsuranceBenefit).toBe(1_000_000);
  });

  it("ILIT-owned policy goes fully to insuranceOutOfEstate", () => {
    const data = emptyClientData();
    data.entities = [ILIT];
    data.accounts = [
      whole({
        id: "p1",
        faceValue: 5_000_000,
        owners: [{ kind: "entity", entityId: "ilit-1", percent: 1 }],
      }),
    ];
    const projection = {
      years: [projectionYear({ year: 2026, hypothetical: htMarried({ firstTax: 0, finalTax: 0 }) })],
    } as unknown as ProjectionResult;

    const report = buildYearlyLiquidityReport({
      projection,
      clientData: data,
      ownerNames: NAMES,
      ownerDobs: DOBS,
    });
    expect(report.rows[0].insuranceInEstate).toBe(0);
    expect(report.rows[0].insuranceOutOfEstate).toBe(5_000_000);
  });

  it("term policy outside its window contributes $0", () => {
    const data = emptyClientData();
    data.accounts = [
      term({
        id: "p1",
        faceValue: 1_000_000,
        owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        termIssueYear: 2020,
        termLengthYears: 5, // expires end of 2024
      }),
    ];
    const projection = {
      years: [projectionYear({ year: 2026, hypothetical: htMarried({ firstTax: 0, finalTax: 0 }) })],
    } as unknown as ProjectionResult;

    const report = buildYearlyLiquidityReport({
      projection,
      clientData: data,
      ownerNames: NAMES,
      ownerDobs: DOBS,
    });
    expect(report.rows[0].insuranceInEstate).toBe(0);
    expect(report.rows[0].insuranceOutOfEstate).toBe(0);
  });

  it("insuredPerson='spouse' with endsAtInsuredRetirement uses spouse retirement year", () => {
    const data = emptyClientData();
    // Spouse DOB 1962-01-01, retirementAge 65 → retirement year 2027
    data.accounts = [
      {
        ...whole({
          id: "p1",
          faceValue: 2_000_000,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
          insuredPerson: "spouse",
        }),
        lifeInsurance: {
          ...whole({
            id: "p1",
            faceValue: 2_000_000,
            owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
          }).lifeInsurance!,
          endsAtInsuredRetirement: true,
        },
      },
    ];
    const projection = {
      years: [
        projectionYear({ year: 2026, hypothetical: htMarried({ firstTax: 0, finalTax: 0 }) }),
        projectionYear({ year: 2027, hypothetical: htMarried({ firstTax: 0, finalTax: 0 }) }),
      ],
    } as unknown as ProjectionResult;

    const report = buildYearlyLiquidityReport({
      projection,
      clientData: data,
      ownerNames: NAMES,
      ownerDobs: DOBS,
    });
    expect(report.rows[0].insuranceInEstate).toBe(2_000_000);
    expect(report.rows[1].insuranceInEstate).toBe(0);
  });

  it("joint policy ends at the later of client/spouse retirement", () => {
    const data = emptyClientData();
    // client retirement year 2025 (1960+65); spouse retirement year 2027
    data.client = { ...data.client, retirementAge: 65, spouseRetirementAge: 65 };
    data.accounts = [
      {
        ...whole({
          id: "p1",
          faceValue: 1_500_000,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
          insuredPerson: "joint",
        }),
        lifeInsurance: {
          ...whole({
            id: "p1",
            faceValue: 1_500_000,
            owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
          }).lifeInsurance!,
          endsAtInsuredRetirement: true,
        },
      },
    ];
    const projection = {
      years: [
        projectionYear({ year: 2026, hypothetical: htMarried({ firstTax: 0, finalTax: 0 }) }),
        projectionYear({ year: 2027, hypothetical: htMarried({ firstTax: 0, finalTax: 0 }) }),
      ],
    } as unknown as ProjectionResult;

    const report = buildYearlyLiquidityReport({
      projection,
      clientData: data,
      ownerNames: NAMES,
      ownerDobs: DOBS,
    });
    expect(report.rows[0].insuranceInEstate).toBe(1_500_000); // 2026 < 2027
    expect(report.rows[1].insuranceInEstate).toBe(0);          // 2027 = later retirement
  });
});
