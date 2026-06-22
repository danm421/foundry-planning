import { describe, it, expect } from "vitest";
import { buildIntakeDiff } from "@/components/intake/admin/diff-utils";
import type { IntakePayload } from "@/lib/intake/schema";

const emptyMeta = { completedSections: [] as string[] };

const minPayload: IntakePayload = {
  family: {
    primary: { firstName: "Jane", lastName: "Doe", dateOfBirth: "1975-06-15", maritalStatus: "married" },
    spouse: null,
    stateOfResidence: "CA",
    children: [],
  },
  accounts: [],
  income: [],
  property: [],
  goals: { clientRetirementAge: 65 },
  meta: emptyMeta,
};

describe("buildIntakeDiff", () => {
  it("marks unchanged fields when baseline equals submitted", () => {
    const diff = buildIntakeDiff(minPayload, minPayload);
    expect(diff.family.primaryName).toEqual({ changed: false, value: "Jane Doe" });
    expect(diff.family.stateOfResidence).toEqual({ changed: false, value: "CA" });
  });

  it("marks changed fields when values differ", () => {
    const updated: IntakePayload = {
      ...minPayload,
      family: {
        ...minPayload.family,
        primary: { ...minPayload.family.primary, firstName: "Janet" },
      },
    };
    const diff = buildIntakeDiff(minPayload, updated);
    expect(diff.family.primaryName).toEqual({ changed: true, old: "Jane Doe", new: "Janet Doe" });
  });

  it("treats null baseline as all-new (fields show as changed from undefined)", () => {
    const diff = buildIntakeDiff(null, minPayload);
    // When baseline is null, baseline values are undefined — diff marks as changed
    expect(diff.family.primaryName).toEqual({ changed: true, old: undefined, new: "Jane Doe" });
    expect(diff.accounts.baselineCount).toBe(0);
  });

  it("summarises accounts list by count and items", () => {
    const withAccounts: IntakePayload = {
      ...minPayload,
      accounts: [
        { name: "Fidelity", category: "taxable", value: 100000 },
        { name: "Roth", category: "retirement", value: 50000 },
      ],
    };
    const diff = buildIntakeDiff(null, withAccounts);
    expect(diff.accounts.submittedCount).toBe(2);
    expect(diff.accounts.submittedItems[0].name).toBe("Fidelity");
  });

  it("detects goals retirement age change", () => {
    const updated: IntakePayload = {
      ...minPayload,
      goals: { clientRetirementAge: 60 },
    };
    const diff = buildIntakeDiff(minPayload, updated);
    expect(diff.goals.clientRetirementAge).toEqual({ changed: true, old: 65, new: 60 });
  });

  it("handles missing spouse gracefully", () => {
    const diff = buildIntakeDiff(null, minPayload);
    expect(diff.family.spouseName).toEqual({ changed: false, value: undefined });
  });
});
