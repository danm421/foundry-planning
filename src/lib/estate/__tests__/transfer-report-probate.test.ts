import { describe, it, expect } from "vitest";
import { buildEstateTransferReportData } from "../transfer-report";
import type {
  ClientData,
  DeathTransfer,
  EstateTaxResult,
  HypotheticalEstateTax,
  HypotheticalEstateTaxOrdering,
} from "@/engine/types";
import type { ProjectionResult } from "@/engine";

// ── Fixture helpers (mirrors transfer-report.test.ts conventions) ─────────────

function transfer(partial: Partial<DeathTransfer>): DeathTransfer {
  return {
    year: 2030,
    deathOrder: 2,
    deceased: "spouse",
    sourceAccountId: "acc-brokerage",
    sourceAccountName: "Joint Brokerage",
    sourceLiabilityId: null,
    sourceLiabilityName: null,
    via: "fallback_children",
    recipientKind: "family_member",
    recipientId: "fm-child-1",
    recipientLabel: "Alex",
    amount: 500_000,
    basis: 200_000,
    resultingAccountId: null,
    resultingLiabilityId: null,
    ...partial,
  };
}

function emptyEstateTaxResult(deceased: "client" | "spouse", deathOrder: 1 | 2): EstateTaxResult {
  return {
    year: 2030,
    deathOrder,
    deceased,
    grossEstate: 0,
    grossEstateLines: [],
    estateAdminExpenses: 0,
    probateCost: 0,
    maritalDeduction: 0,
    charitableDeduction: 0,
    taxableEstate: 0,
    adjustedTaxableGifts: 0,
    tentativeTaxBase: 0,
    tentativeTax: 0,
    unifiedCredit: 0,
    applicableExclusion: 0,
    beaAtDeathYear: 0,
    dsueReceived: 0,
    dsueGenerated: 0,
    federalEstateTax: 0,
    stateEstateTaxRate: 0,
    stateEstateTax: 0,
    totalEstateTax: 0,
    totalTaxesAndExpenses: 0,
    estateTaxDebits: [],
    creditorPayoffDebits: [],
    creditorPayoffResidual: 0,
    drainAttributions: [],
  } as unknown as EstateTaxResult;
}

function ordering(
  partial: Partial<HypotheticalEstateTaxOrdering> = {},
): HypotheticalEstateTaxOrdering {
  return {
    firstDecedent: "client",
    firstDeath: emptyEstateTaxResult("client", 1),
    firstDeathTransfers: [],
    totals: { federal: 0, state: 0, admin: 0, total: 0 },
    ...partial,
  };
}

function projection(years: { year: number; ht: HypotheticalEstateTax }[]): ProjectionResult {
  return {
    years: years.map((y) => ({ year: y.year, hypotheticalEstateTax: y.ht })),
    todayHypotheticalEstateTax: years[0]?.ht,
    firstDeathEvent: null,
    secondDeathEvent: null,
  } as unknown as ProjectionResult;
}

function tree(): ClientData {
  return {
    familyMembers: [
      { id: "fm-client", role: "client", relationship: "other", firstName: "Pat", lastName: null, dateOfBirth: "1970-01-01" },
      { id: "fm-spouse", role: "spouse", relationship: "other", firstName: "Sam", lastName: null, dateOfBirth: "1972-01-01" },
      { id: "fm-child-1", role: "child", relationship: "child", firstName: "Alex", lastName: null, dateOfBirth: "2005-01-01" },
    ],
    entities: [],
    externalBeneficiaries: [],
    wills: [],
    accounts: [],
  } as unknown as ClientData;
}

function sumDrains(d: Record<string, number>): number {
  return Object.values(d).reduce((s, v) => s + v, 0);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("transfer-report — probate", () => {
  it("emits a distinct Probate Costs reductions line and reduces heir netTotal", () => {
    // Second-death scenario: Sam dies, Alex (family_member) inherits $500k gross.
    // The estate has $20,000 in probate costs attributed proportionally to Alex.
    const PROBATE_COST = 20_000;

    const secondTax = emptyEstateTaxResult("spouse", 2);
    Object.assign(secondTax, {
      grossEstate: 500_000,
      probateCost: PROBATE_COST,
      drainAttributions: [
        {
          deathOrder: 2,
          recipientKind: "family_member",
          recipientId: "fm-child-1",
          drainKind: "probate",
          amount: PROBATE_COST,
        },
      ],
    });

    const transfers = [
      transfer({
        deathOrder: 2,
        deceased: "spouse",
        sourceAccountId: "acc-brokerage",
        sourceAccountName: "Joint Brokerage",
        via: "fallback_children",
        recipientKind: "family_member",
        recipientId: "fm-child-1",
        recipientLabel: "Alex",
        amount: 500_000,
      }),
    ];

    const ht: HypotheticalEstateTax = {
      year: 2030,
      primaryFirst: ordering({
        firstDecedent: "client",
        firstDeath: emptyEstateTaxResult("client", 1),
        firstDeathTransfers: [],
        finalDeath: secondTax,
        finalDeathTransfers: transfers,
      }),
    };

    const data = buildEstateTransferReportData({
      projection: projection([{ year: 2030, ht }]),
      asOf: { kind: "today" },
      ordering: "primaryFirst",
      clientData: tree(),
      ownerNames: { clientName: "Pat", spouseName: "Sam" },
    });

    // Use secondDeath (Sam is the second decedent in primaryFirst ordering).
    const section = data.secondDeath!;
    expect(section).not.toBeNull();

    // 1. A probate reductions line must exist with the correct label and amount.
    const probateLine = section.reductions.find((r) => r.kind === "probate");
    expect(probateLine).toBeDefined();
    expect(probateLine!.label).toBe("Probate Costs");
    expect(probateLine!.amount).toBe(PROBATE_COST);

    // 2. The heir's drainsByKind.probate must reflect the attribution.
    const heir = section.recipients.find((r) => r.recipientId === "fm-child-1")!;
    expect(heir).toBeDefined();
    expect(heir.drainsByKind.probate).toBe(PROBATE_COST);

    // 3. netTotal = gross total − sum of all drain kinds (within 1-cent tolerance).
    expect(heir.netTotal).toBeCloseTo(heir.total - sumDrains(heir.drainsByKind), 2);
    expect(heir.netTotal).toBe(500_000 - PROBATE_COST);
  });

  it("orders probate line after state_estate_tax and before admin_expenses", () => {
    // Build a fixture with all four drain types to assert ordering explicitly.
    const secondTax = emptyEstateTaxResult("spouse", 2);
    Object.assign(secondTax, {
      grossEstate: 1_000_000,
      stateEstateTax: 50_000,
      probateCost: 20_000,
      estateAdminExpenses: 10_000,
      drainAttributions: [
        { deathOrder: 2, recipientKind: "family_member", recipientId: "fm-child-1", drainKind: "state_estate_tax", amount: 50_000 },
        { deathOrder: 2, recipientKind: "family_member", recipientId: "fm-child-1", drainKind: "probate", amount: 20_000 },
        { deathOrder: 2, recipientKind: "family_member", recipientId: "fm-child-1", drainKind: "admin_expenses", amount: 10_000 },
      ],
    });

    const transfers = [
      transfer({
        deathOrder: 2,
        deceased: "spouse",
        recipientKind: "family_member",
        recipientId: "fm-child-1",
        recipientLabel: "Alex",
        amount: 1_000_000,
      }),
    ];

    const ht: HypotheticalEstateTax = {
      year: 2030,
      primaryFirst: ordering({
        firstDecedent: "client",
        firstDeath: emptyEstateTaxResult("client", 1),
        firstDeathTransfers: [],
        finalDeath: secondTax,
        finalDeathTransfers: transfers,
      }),
    };

    const data = buildEstateTransferReportData({
      projection: projection([{ year: 2030, ht }]),
      asOf: { kind: "today" },
      ordering: "primaryFirst",
      clientData: tree(),
      ownerNames: { clientName: "Pat", spouseName: "Sam" },
    });

    const kinds = data.secondDeath!.reductions.map((r) => r.kind);
    const stateIdx = kinds.indexOf("state_estate_tax");
    const probateIdx = kinds.indexOf("probate");
    const adminIdx = kinds.indexOf("admin_expenses");

    expect(probateIdx).toBeGreaterThan(stateIdx);
    expect(probateIdx).toBeLessThan(adminIdx);
  });
});
