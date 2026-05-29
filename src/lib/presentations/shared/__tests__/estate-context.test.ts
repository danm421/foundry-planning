import { describe, it, expect } from "vitest";
import { prepEstate, resolveAsOfYear } from "../estate-context";
import { runProjectionWithEvents } from "@/engine/projection";
import type { ProjectionResult } from "@/engine/projection";
import type { ClientData } from "@/engine/types";
import type { BuildDataContext } from "@/components/presentations/registry";

function fakeProjection(years: number[]): ProjectionResult {
  return { years: years.map((year) => ({ year })) } as unknown as ProjectionResult;
}

describe("resolveAsOfYear", () => {
  const projection = fakeProjection([2026, 2027, 2028]);

  it("maps today/split to the plan start year", () => {
    expect(resolveAsOfYear({ kind: "today" }, projection)).toBe(2026);
    expect(resolveAsOfYear({ kind: "split" }, projection)).toBe(2026);
  });

  it("passes an explicit year through", () => {
    expect(resolveAsOfYear({ kind: "year", year: 2031 }, projection)).toBe(2031);
  });

  it("falls back to the current year when projection has no years", () => {
    const empty = fakeProjection([]);
    const y = resolveAsOfYear({ kind: "today" }, empty);
    expect(y).toBe(new Date().getFullYear());
  });
});

// A married-couple ClientData with two estate-bearing accounts (one joint, one
// SLAT-owned), an ILIT term policy, an irrevocable trust, and a will leaving
// the residue to the children. Both spouses' life expectancies fall inside the
// plan window so the projection fires both death events — enough to exercise
// every estate lib that prepEstate composes.
const FM_CLIENT = "fm-client";
const FM_SPOUSE = "fm-spouse";
const FM_CHILD = "fm-child";
const ILIT = "trust-ilit";
const SLAT = "trust-slat";

function marriedCoupleScenario(): ClientData {
  return {
    client: {
      firstName: "Tom",
      lastName: "Cooper",
      dateOfBirth: "1968-01-01",
      retirementAge: 65,
      planEndAge: 88,
      lifeExpectancy: 88,
      filingStatus: "married_joint",
      spouseDob: "1970-01-01",
      spouseLifeExpectancy: 88,
    },
    accounts: [
      {
        id: "joint-broker",
        name: "Joint brokerage",
        category: "taxable",
        subType: "individual",
        value: 12_000_000,
        basis: 8_000_000,
        growthRate: 0.06,
        rmdEnabled: false,
        owners: [
          { kind: "family_member", familyMemberId: FM_CLIENT, percent: 0.5 },
          { kind: "family_member", familyMemberId: FM_SPOUSE, percent: 0.5 },
        ],
      },
      {
        id: "slat-acc",
        name: "SLAT brokerage",
        category: "taxable",
        subType: "individual",
        value: 2_400_000,
        basis: 2_400_000,
        growthRate: 0.06,
        rmdEnabled: false,
        owners: [{ kind: "entity", entityId: SLAT, percent: 1 }],
      },
      {
        id: "ilit-policy",
        name: "Term life policy",
        category: "life_insurance",
        subType: "term",
        value: 0,
        basis: 0,
        growthRate: 0,
        rmdEnabled: false,
        lifeInsurance: { faceValue: 5_000_000 },
        owners: [{ kind: "entity", entityId: ILIT, percent: 1 }],
      },
    ],
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: {
      flatFederalRate: 0.4,
      flatStateRate: 0.06,
      inflationRate: 0.025,
      planStartYear: 2026,
      planEndYear: 2066,
      taxEngineMode: "flat",
      taxInflationRate: 0.025,
      flatStateEstateRate: 0.12,
      estateAdminExpenses: 50_000,
    },
    entities: [
      {
        id: ILIT,
        name: "Cooper ILIT",
        entityType: "trust",
        trustSubType: "ilit",
        isIrrevocable: true,
        isGrantor: false,
        includeInPortfolio: false,
        grantor: "client",
      },
      {
        id: SLAT,
        name: "Cooper SLAT",
        entityType: "trust",
        trustSubType: "irrevocable",
        isIrrevocable: true,
        isGrantor: true,
        includeInPortfolio: false,
        grantor: "client",
      },
    ],
    deductions: [],
    transfers: [],
    assetTransactions: [],
    gifts: [],
    giftEvents: [],
    wills: [
      {
        id: "will-client",
        grantor: "client",
        bequests: [],
        residuaryRecipients: [
          { recipientKind: "spouse", recipientId: null, percentage: 1, sortOrder: 0 },
        ],
      },
      {
        id: "will-spouse",
        grantor: "spouse",
        bequests: [],
        residuaryRecipients: [
          { recipientKind: "family_member", recipientId: FM_CHILD, percentage: 1, sortOrder: 0 },
        ],
      },
    ],
    familyMembers: [
      { id: FM_CLIENT, firstName: "Tom", lastName: "Cooper", relationship: "other", role: "client", dateOfBirth: "1968-01-01" },
      { id: FM_SPOUSE, firstName: "Linda", lastName: "Cooper", relationship: "other", role: "spouse", dateOfBirth: "1970-01-01" },
      { id: FM_CHILD, firstName: "Casey", lastName: "Cooper", relationship: "child", role: "child", dateOfBirth: "2000-01-01" },
    ],
    externalBeneficiaries: [],
  } as unknown as ClientData;
}

function makeContext(projection: ProjectionResult, clientData: ClientData): BuildDataContext {
  return {
    projection,
    clientData,
    clientName: "Tom Cooper",
    spouseName: "Linda Cooper",
  } as unknown as BuildDataContext;
}

describe("prepEstate", () => {
  const clientData = marriedCoupleScenario();
  const projection = runProjectionWithEvents(clientData);
  const ctx = makeContext(projection, clientData);
  const prep = prepEstate(ctx, { kind: "split" });

  it("composes the transfer report from the projection", () => {
    expect(prep.reportData).toBeDefined();
    // A married couple with estate-bearing assets and wills produces a
    // non-empty transfer report.
    expect(prep.reportData.isEmpty).toBe(false);
  });

  it("composes the ownership column with a non-negative grand total", () => {
    expect(prep.ownership).toBeDefined();
    expect(typeof prep.ownership.grandTotal).toBe("number");
    expect(prep.ownership.grandTotal).toBeGreaterThanOrEqual(0);
  });

  it("builds the estate-flow summary for a non-empty estate", () => {
    // reportData is non-empty, so buildEstateFlowSummary returns a struct
    // (not the null short-circuit reserved for empty estates).
    expect(prep.summary).not.toBeNull();
  });

  it("frames the plan years from the projection's first/last rows", () => {
    const years = projection.years;
    expect(prep.planStartYear).toBe(years[0].year);
    expect(prep.planEndYear).toBe(years[years.length - 1].year);
    // split resolves to the plan start year.
    expect(prep.asOfYear).toBe(prep.planStartYear);
    expect(prep.asOfYear).toBe(2026);
  });
});
