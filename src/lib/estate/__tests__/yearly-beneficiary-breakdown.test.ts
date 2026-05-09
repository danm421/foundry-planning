import { describe, it, expect } from "vitest";
import {
  buildYearlyBeneficiaryBreakdown,
  type YearlyBeneficiaryBreakdown,
} from "../yearly-beneficiary-breakdown";
import type { ProjectionResult } from "@/engine";
import type {
  ProjectionYear,
  EstateTaxResult,
  HypotheticalEstateTax,
  HypotheticalEstateTaxOrdering,
  DeathTransfer,
  ClientData,
} from "@/engine/types";

// ── Fixture builders ────────────────────────────────────────────────────────

function makeEstateTax(deathOrder: 1 | 2): EstateTaxResult {
  return {
    deathOrder,
    year: 2030,
    grossEstate: 1_000_000,
    taxableEstate: 1_000_000,
    federalEstateTax: 0,
    stateEstateTax: 0,
    estateAdminExpenses: 0,
    estateTaxDebits: [],
    creditorPayoffDebits: [],
    drainAttributions: [],
    charitableDeduction: 0,
    maritalDeduction: 0,
    appliedExclusion: 0,
    portableExclusion: 0,
  } as unknown as EstateTaxResult;
}

function makeTransfer(
  recipientKind: DeathTransfer["recipientKind"],
  recipientId: string | null,
  amount: number,
  via: DeathTransfer["via"] = "titling",
): DeathTransfer {
  return {
    recipientKind,
    recipientId,
    via,
    amount,
    basis: 0,
    sourceAccountId: "acct-1",
    sourceAccountName: "Test Account",
    sourceLiabilityId: null,
    sourceLiabilityName: null,
    deathOrder: 1,
  } as DeathTransfer;
}

function makeOrdering(
  firstTransfers: DeathTransfer[],
  secondTransfers: DeathTransfer[] | null = null,
): HypotheticalEstateTaxOrdering {
  return {
    firstDecedent: "client",
    firstDeath: makeEstateTax(1),
    firstDeathTransfers: firstTransfers,
    finalDeath: secondTransfers ? makeEstateTax(2) : null,
    finalDeathTransfers: secondTransfers,
  } as HypotheticalEstateTaxOrdering;
}

function makeYear(
  year: number,
  ordering: HypotheticalEstateTaxOrdering | null,
): ProjectionYear {
  return {
    year,
    hypotheticalEstateTax: ordering
      ? ({ year, primaryFirst: ordering, spouseFirst: null } as unknown as HypotheticalEstateTax)
      : undefined,
    deathTransfers: [],
    income: { salaries: 0, socialSecurity: 0, business: 0, trust: 0, deferred: 0, capitalGains: 0, other: 0 },
  } as unknown as ProjectionYear;
}

const baseClientData: ClientData = {
  client: {
    id: "client-1",
    firstName: "Test",
    lastName: "Client",
    dateOfBirth: "1970-01-01",
    retirementAge: 65,
    planEndAge: 90,
    lifeExpectancy: 90,
    filingStatus: "married_joint",
  },
  familyMembers: [
    { id: "fm-spouse", firstName: "Sarah", role: "spouse" },
    { id: "fm-child-1", firstName: "Charlie", role: "child" },
    { id: "fm-child-2", firstName: "Diana", role: "child" },
  ],
  externalBeneficiaries: [
    { id: "ext-charity", name: "Red Cross", kind: "charity" },
  ],
  entities: [],
  accounts: [],
  liabilities: [],
  expenses: [],
  incomes: [],
  scenarios: [],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const ownerNames = { clientName: "Cooper", spouseName: "Sarah" };

// ── Tests ───────────────────────────────────────────────────────────────────

describe("buildYearlyBeneficiaryBreakdown", () => {
  it("returns one row per projection year, even when a year has no hypothetical estate tax", () => {
    const projection = {
      years: [makeYear(2026, null), makeYear(2027, null)],
    } as unknown as ProjectionResult;
    const result = buildYearlyBeneficiaryBreakdown(
      projection,
      "primaryFirst",
      baseClientData,
      ownerNames,
    );
    expect(result.rows.length).toBe(2);
    expect(result.rows.every((r) => r.beneficiaries.length === 0)).toBe(true);
  });

  it("excludes spouse from beneficiary lists and lifetime totals", () => {
    const transfers = [
      makeTransfer("spouse", "fm-spouse", 500_000),
      makeTransfer("family_member", "fm-child-1", 250_000),
    ];
    const projection = {
      years: [makeYear(2030, makeOrdering(transfers))],
    } as unknown as ProjectionResult;
    const result = buildYearlyBeneficiaryBreakdown(
      projection,
      "primaryFirst",
      baseClientData,
      ownerNames,
    );
    expect(result.beneficiaries.find((b) => b.recipientLabel === "Sarah")).toBeUndefined();
    expect(result.beneficiaries.find((b) => b.recipientLabel === "Charlie")).toBeDefined();
    const charlieRow = result.rows[0]?.beneficiaries.find((b) => b.recipientLabel === "Charlie");
    expect(charlieRow?.fromFirstDeath).toBeGreaterThan(0);
  });

  it("aggregates lifetime totals across all years and sorts beneficiaries desc by lifetime total", () => {
    const yearA = makeYear(
      2030,
      makeOrdering([makeTransfer("family_member", "fm-child-1", 100_000)]),
    );
    const yearB = makeYear(
      2031,
      makeOrdering([
        makeTransfer("family_member", "fm-child-1", 200_000),
        makeTransfer("family_member", "fm-child-2", 500_000),
      ]),
    );
    const projection = {
      years: [yearA, yearB],
    } as unknown as ProjectionResult;
    const result = buildYearlyBeneficiaryBreakdown(
      projection,
      "primaryFirst",
      baseClientData,
      ownerNames,
    );
    expect(result.beneficiaries.map((b) => b.recipientLabel)).toEqual([
      "Diana",
      "Charlie",
    ]);
    expect(result.beneficiaries[0].lifetimeTotal).toBe(500_000);
    expect(result.beneficiaries[1].lifetimeTotal).toBe(300_000);
  });

  it("propagates the chosen ordering through to buildEstateTransferReportData", () => {
    // Smoke check: passing primaryFirst vs spouseFirst should not crash and
    // should produce the same shape when only primaryFirst is populated.
    const transfers = [makeTransfer("family_member", "fm-child-1", 100_000)];
    const projection = {
      years: [makeYear(2030, makeOrdering(transfers))],
    } as unknown as ProjectionResult;
    const a = buildYearlyBeneficiaryBreakdown(projection, "primaryFirst", baseClientData, ownerNames);
    const b = buildYearlyBeneficiaryBreakdown(projection, "spouseFirst", baseClientData, ownerNames);
    expect(a.ordering).toBe("primaryFirst");
    expect(b.ordering).toBe("spouseFirst");
  });
});
