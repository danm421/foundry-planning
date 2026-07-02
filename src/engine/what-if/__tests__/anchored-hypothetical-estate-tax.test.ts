import { describe, it, expect } from "vitest";
import { computeAnchoredHypotheticalEstateTax } from "../hypothetical-estate-tax";
import type { EstateTaxResult, DeathTransfer } from "../../types";

// Minimal frozen first-death stub: only the fields the assembler copies through.
const frozenFirstDeath = {
  deathOrder: 1,
  deceased: "spouse",
  grossEstate: 1_000_000,
  totalTaxesAndExpenses: 50_000,
  drainAttributions: [],
} as unknown as EstateTaxResult;

const frozenTransfers: DeathTransfer[] = [];

// A one-account survivor estate so applyFinalDeath produces a real second death.
function survivorInput(year: number) {
  return {
    year,
    survivor: "client" as const,
    realFirstDeath: {
      decedent: "spouse" as const,
      estateTax: frozenFirstDeath,
      transfers: frozenTransfers,
      dsueGenerated: 0,
    },
    accounts: [
      {
        id: "a1",
        name: "Brokerage",
        category: "taxable",
        value: 2_000_000,
        owners: [{ kind: "family_member", familyMemberId: "client", percent: 1 }],
      },
    ],
    accountBalances: { a1: 2_000_000 },
    basisMap: { a1: 2_000_000 },
    incomes: [],
    liabilities: [],
    familyMembers: [
      { id: "client", role: "client", firstName: "Frank", lastName: "Doyle" },
      { id: "kid", role: "child", firstName: "Sam", lastName: "Doyle" },
    ],
    externalBeneficiaries: [],
    entities: [],
    wills: [],
    planSettings: { planStartYear: 2026, planEndYear: 2060, priorTaxableGifts: { client: 0, spouse: 0 } },
    gifts: [],
    giftEvents: [],
    relocations: [],
    yearEndAccountBalances: new Map<number, Record<string, number>>(),
    annualExclusionsByYear: {},
    priorTaxableGifts: { client: 0, spouse: 0 },
    entityAccountSharesEoY: new Map(),
    familyAccountSharesEoY: new Map(),
  } as unknown as import("../hypothetical-estate-tax").AnchoredHypotheticalInput;
}

describe("computeAnchoredHypotheticalEstateTax", () => {
  it("freezes the real first death and pairs it with the survivor's death at N", () => {
    const r = computeAnchoredHypotheticalEstateTax(survivorInput(2047));
    expect(r.year).toBe(2047);
    expect(r.spouseFirst).toBeUndefined();
    // First death is the frozen real event, unchanged.
    expect(r.primaryFirst.firstDecedent).toBe("spouse");
    expect(r.primaryFirst.firstDeath).toBe(frozenFirstDeath);
    // Survivor's death at N is present and reflects the survivor estate.
    expect(r.primaryFirst.finalDeath).toBeDefined();
    expect(r.primaryFirst.finalDeath!.deceased).toBe("client");
    expect(r.primaryFirst.finalDeath!.grossEstate).toBeGreaterThan(0);
  });

  it("keeps the frozen first death identical across viewing years (freeze)", () => {
    const a = computeAnchoredHypotheticalEstateTax(survivorInput(2047));
    const b = computeAnchoredHypotheticalEstateTax(survivorInput(2052));
    expect(a.primaryFirst.firstDeath).toBe(b.primaryFirst.firstDeath);
    expect(a.primaryFirst.firstDeathTransfers).toBe(b.primaryFirst.firstDeathTransfers);
  });
});
