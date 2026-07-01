import { describe, it, expect } from "vitest";
import { resolveRefYears } from "../year-refs";
import type { ClientData } from "@/engine/types";

function baseTree(): ClientData {
  // Minimal tree: client retiring in 2040, plan 2025–2060, one future account
  // anchored to client_retirement.
  //
  // NOTE: dateOfBirth deliberately avoids "-01-01" — `buildClientMilestones`
  // does `new Date(dob).getFullYear()`, which parses as UTC midnight and
  // reads back one year early in negative-UTC-offset zones (e.g. US
  // Eastern). Pre-existing, out-of-scope TZ bug; see other milestone tests
  // (`src/lib/__tests__/milestones.test.ts`) which use mid-year DOBs for the
  // same reason.
  return {
    client: { dateOfBirth: "1975-06-15", retirementAge: 65 } as ClientData["client"],
    planSettings: { planStartYear: 2025, planEndYear: 2060 } as ClientData["planSettings"],
    accounts: [
      {
        id: "a1", name: "Inheritance", category: "taxable", subType: "brokerage",
        value: 500000, basis: 500000, growthRate: 0.05, rmdEnabled: false,
        titlingType: "jtwros", owners: [],
        activationYear: 2030, activationYearRef: "client_retirement",
      },
    ] as ClientData["accounts"],
    incomes: [], expenses: [], savingsRules: [], withdrawalStrategy: [],
    entities: [], transfers: [], rothConversions: [],
  } as unknown as ClientData;
}

describe("resolveRefYears — account activation", () => {
  it("re-anchors activationYear from activationYearRef", () => {
    const out = resolveRefYears(baseTree());
    // client born 1975, retires at 65 → 2040. Stored fallback (2030) is overridden.
    expect(out.accounts[0].activationYear).toBe(2040);
  });

  it("leaves a ref-less account's activationYear untouched", () => {
    const tree = baseTree();
    tree.accounts[0].activationYearRef = null;
    tree.accounts[0].activationYear = 2033;
    const out = resolveRefYears(tree);
    expect(out.accounts[0].activationYear).toBe(2033);
  });
});
