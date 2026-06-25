import { describe, it, expect } from "vitest";
import {
  intakeSubmitSchema,
  intakeDraftSchema,
  maritalToFilingStatus,
  pruneIntakeBlankRows,
} from "../schema";

describe("intake schema", () => {
  it("accepts a complete submission", () => {
    const ok = intakeSubmitSchema.safeParse({
      family: {
        primary: { firstName: "Cooper", lastName: "Sample", dateOfBirth: "1975-06-20", maritalStatus: "married" },
        spouse: { firstName: "Susan", lastName: "Sample", dateOfBirth: "1979-01-01", maritalStatus: "married" },
        stateOfResidence: "PA",
        children: [{ firstName: "Caroline", lastName: "Sample", dateOfBirth: "2015-05-05" }],
      },
      accounts: [{ name: "401k", category: "retirement", value: 1200000 }],
      income: [{ name: "Cooper's Salary", type: "salary", annualAmount: 200000, owner: "client" }],
      property: [{ name: "Home", kind: "real_estate", value: 650000 }],
      goals: { clientRetirementAge: 65, spouseRetirementAge: 61, annualRetirementExpenses: 145000 },
      meta: { completedSections: ["family", "assets", "goals"] },
    });
    expect(ok.success).toBe(true);
  });

  it("rejects submission missing primary DOB", () => {
    const bad = intakeSubmitSchema.safeParse({ family: { primary: { firstName: "A", lastName: "B" }, children: [] } });
    expect(bad.success).toBe(false);
  });

  it("draft schema tolerates a half-filled payload", () => {
    const draft = intakeDraftSchema.safeParse({ family: { children: [] }, accounts: [] });
    expect(draft.success).toBe(true);
  });

  it("draft schema accepts freshly-added blank rows (the autosave path)", () => {
    // A blank row carries name "" / amount 0 — `.partial()` of the strict
    // schema used to reject "" against min(1), 422-ing every autosave.
    const draft = intakeDraftSchema.safeParse({
      family: {
        primary: { firstName: "", lastName: "", dateOfBirth: "" },
        spouse: { firstName: "", lastName: "", dateOfBirth: "" },
        children: [{ firstName: "", lastName: "", dateOfBirth: "" }],
      },
      accounts: [{ name: "", category: "taxable", value: 0 }],
      income: [{ name: "", type: "salary", annualAmount: 0, owner: "client" }],
      property: [{ name: "", kind: "real_estate", value: 0 }],
      // mid-typing a retirement age ("4") is below the strict min(40) — draft
      // must still persist it.
      goals: { clientRetirementAge: 4 },
    });
    expect(draft.success).toBe(true);
  });

  it("prunes fully-blank optional rows but keeps named ones", () => {
    const pruned = pruneIntakeBlankRows({
      family: {
        primary: { firstName: "A", lastName: "B", dateOfBirth: "1975-06-20" },
        children: [
          { firstName: "", lastName: "", dateOfBirth: "" },
          { firstName: "Caroline", dateOfBirth: "2015-05-05" },
        ],
      },
      accounts: [
        { name: "", category: "taxable", value: 0 },
        { name: "401k", category: "retirement", value: 1000 },
      ],
      income: [{ name: "", type: "salary", annualAmount: 0, owner: "client" }],
      property: [],
    }) as Record<string, { length?: number } | undefined> & {
      accounts: unknown[];
      income: unknown[];
      family: { children: unknown[] };
    };

    expect(pruned.accounts).toHaveLength(1);
    expect(pruned.income).toHaveLength(0);
    expect(pruned.family.children).toHaveLength(1);
  });

  it("a pruned + completed payload passes strict submit validation", () => {
    const raw = {
      family: {
        primary: { firstName: "Cooper", lastName: "Sample", dateOfBirth: "1975-06-20", maritalStatus: "single" },
        children: [],
      },
      // user added an income row via the wizard, then skipped it blank
      income: [{ name: "", type: "salary", annualAmount: 0, owner: "client" }],
      accounts: [],
      property: [],
    };
    expect(intakeSubmitSchema.safeParse(raw).success).toBe(false); // blank row blocks it
    expect(intakeSubmitSchema.safeParse(pruneIntakeBlankRows(raw)).success).toBe(true);
  });

  it("caps array lengths", () => {
    const tooMany = intakeSubmitSchema.safeParse({
      family: { primary: { firstName: "A", lastName: "B", dateOfBirth: "1975-06-20" }, children: [] },
      accounts: Array.from({ length: 51 }, () => ({ name: "x", category: "cash", value: 1 })),
    });
    expect(tooMany.success).toBe(false);
  });

  it("maps marital status to filing status", () => {
    expect(maritalToFilingStatus("married")).toBe("married_joint");
    expect(maritalToFilingStatus("single")).toBe("single");
    expect(maritalToFilingStatus("widowed")).toBe("single");
  });
});
