import { describe, it, expect } from "vitest";
import type { ProjectionResult } from "@/engine";
import type {
  Account,
  ClientData,
  EntitySummary,
  ProjectionYear,
  HypotheticalEstateTax,
  EstateTaxResult,
} from "@/engine/types";
import { buildYearlyLiquidityReport } from "./yearly-liquidity-report";
import { buildYearlyEstateReport } from "./yearly-estate-report";

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
  } as unknown as HypotheticalEstateTax;
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

function plainAccount(opts: {
  id: string;
  category: Account["category"];
  value: number;
  owners?: Account["owners"];
}): Account {
  return {
    id: opts.id,
    name: opts.id,
    category: opts.category,
    subType: "x",
    value: opts.value,
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
    owners: opts.owners ?? [
      { kind: "family_member", familyMemberId: "fm-client", percent: 1 },
    ],
  };
}

describe("buildYearlyLiquidityReport — portfolio assets", () => {
  it("sums taxable + cash + retirement at year-end balances; excludes real estate, business, insurance", () => {
    const data = emptyClientData();
    data.accounts = [
      plainAccount({ id: "tax-1", category: "taxable", value: 0 }),
      plainAccount({ id: "cash-1", category: "cash", value: 0 }),
      plainAccount({ id: "ira-1", category: "retirement", value: 0 }),
      plainAccount({ id: "re-1", category: "real_estate", value: 0 }),
      plainAccount({ id: "biz-1", category: "business", value: 0 }),
      whole({
        id: "ins-1",
        faceValue: 0,
        owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
      }),
    ];

    const projection = {
      years: [
        projectionYear({
          year: 2026,
          hypothetical: htMarried({ firstTax: 0, finalTax: 0 }),
          ledgers: {
            "tax-1": { endingValue: 1_000_000 },
            "cash-1": { endingValue: 50_000 },
            "ira-1": { endingValue: 750_000 },
            "re-1": { endingValue: 2_000_000 },
            "biz-1": { endingValue: 5_000_000 },
            "ins-1": { endingValue: 25_000 },
          },
        }),
      ],
    } as unknown as ProjectionResult;

    const report = buildYearlyLiquidityReport({
      projection,
      clientData: data,
      ownerNames: NAMES,
      ownerDobs: DOBS,
    });

    expect(report.rows[0].totalPortfolioAssets).toBe(1_800_000);
  });

  it("apportions portfolio by in-estate ownership (ILIT-held taxable account excluded)", () => {
    const data = emptyClientData();
    data.entities = [ILIT];
    data.accounts = [
      plainAccount({
        id: "tax-ilit",
        category: "taxable",
        value: 0,
        owners: [{ kind: "entity", entityId: "ilit-1", percent: 1 }],
      }),
      plainAccount({
        id: "tax-mine",
        category: "taxable",
        value: 0,
      }),
    ];
    const projection = {
      years: [
        projectionYear({
          year: 2026,
          hypothetical: htMarried({ firstTax: 0, finalTax: 0 }),
          ledgers: {
            "tax-ilit": { endingValue: 1_000_000 },
            "tax-mine": { endingValue: 500_000 },
          },
        }),
      ],
    } as unknown as ProjectionResult;

    const report = buildYearlyLiquidityReport({
      projection,
      clientData: data,
      ownerNames: NAMES,
      ownerDobs: DOBS,
    });
    expect(report.rows[0].totalPortfolioAssets).toBe(500_000);
  });

  it("uses entityAccountSharesEoY so household withdrawals don't drain a SLAT-co-owned slice from the in-estate portfolio total", () => {
    // 70% household / 30% non-IIP irrevocable trust. Household withdrew $79k.
    // Engine's locked entity share for the trust = $300k (untouched). The
    // in-estate portfolio total must show family pool $621k, NOT $921k × 0.7.
    const SLAT: EntitySummary = {
      id: "slat-1",
      name: "SLAT",
      entityType: "trust",
      isIrrevocable: true,
    } as unknown as EntitySummary;
    const data = emptyClientData();
    data.entities = [SLAT];
    data.accounts = [
      plainAccount({
        id: "tax-mixed",
        category: "taxable",
        value: 0,
        owners: [
          { kind: "family_member", familyMemberId: "fm-client", percent: 0.7 },
          { kind: "entity", entityId: "slat-1", percent: 0.3 },
        ],
      }),
    ];

    const yearRow = projectionYear({
      year: 2026,
      hypothetical: htMarried({ firstTax: 0, finalTax: 0 }),
      ledgers: { "tax-mixed": { endingValue: 921_000 } },
    });
    yearRow.entityAccountSharesEoY = new Map([
      ["slat-1", new Map([["tax-mixed", 300_000]])],
    ]);

    const projection = { years: [yearRow] } as unknown as ProjectionResult;
    const report = buildYearlyLiquidityReport({
      projection,
      clientData: data,
      ownerNames: NAMES,
      ownerDobs: DOBS,
    });
    // Family pool $621k → only family slice is in-estate (SLAT is OOE).
    expect(report.rows[0].totalPortfolioAssets).toBeCloseTo(621_000, 6);
  });
});

describe("buildYearlyLiquidityReport — invariants", () => {
  it("surplusDeficitWithPortfolio − totalPortfolioAssets === surplusDeficitInsuranceOnly per row", () => {
    const data = emptyClientData();
    data.accounts = [
      plainAccount({ id: "tax-1", category: "taxable", value: 0 }),
      whole({
        id: "p1",
        faceValue: 2_000_000,
        owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
      }),
    ];
    const projection = {
      years: [
        projectionYear({
          year: 2026,
          hypothetical: htMarried({ firstTax: 100_000, finalTax: 200_000 }),
          ledgers: { "tax-1": { endingValue: 1_500_000 } },
        }),
      ],
    } as unknown as ProjectionResult;

    const report = buildYearlyLiquidityReport({
      projection,
      clientData: data,
      ownerNames: NAMES,
      ownerDobs: DOBS,
    });
    const r = report.rows[0];
    expect(r.surplusDeficitWithPortfolio - r.totalPortfolioAssets).toBe(
      r.surplusDeficitInsuranceOnly,
    );
  });

  it("totalTransferCost matches yearly-estate-report taxesAndExpenses for the same year", () => {
    const data = emptyClientData();
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

    const liquidity = buildYearlyLiquidityReport({
      projection,
      clientData: data,
      ownerNames: NAMES,
      ownerDobs: DOBS,
    });
    const yearly = buildYearlyEstateReport({
      projection,
      clientData: data,
      ordering: "primaryFirst",
      ownerNames: { clientName: "Alice", spouseName: "Bob" },
      ownerDobs: DOBS,
    });

    expect(liquidity.rows[0].totalTransferCost).toBe(yearly.rows[0].taxesAndExpenses);
  });

  it("single-life plan (no spouse) returns ageSpouse=null and uses only firstDeath", () => {
    const data = emptyClientData();
    data.client = {
      ...data.client,
      filingStatus: "single",
      spouseDob: undefined,
      spouseRetirementAge: undefined,
      spouseName: undefined,
    };
    const ht = {
      primaryFirst: {
        firstDecedent: "client",
        firstDeath: deathResult({
          decedent: "client",
          order: 1,
          totalTaxesAndExpenses: 500_000,
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
      clientData: data,
      ownerNames: { clientName: "Alice", spouseName: null },
      ownerDobs: { clientDob: "1960-01-01", spouseDob: null },
    });
    expect(report.rows[0].ageSpouse).toBe(null);
    expect(report.rows[0].totalTransferCost).toBe(500_000);
  });
});
