import { describe, it, expect } from "vitest";
import { deriveStepStatuses } from "@/lib/onboarding/step-status";
import type { ClientData } from "@/engine/types";

function emptyTree(): ClientData {
  return {
    client: {
      id: "c1",
      firstName: "",
      lastName: "",
      dateOfBirth: "",
      retirementAge: 0,
      lifeExpectancy: 0,
      filingStatus: "single",
      spouseName: null,
      spouseLastName: null,
      spouseDob: null,
      spouseRetirementAge: null,
      spouseLifeExpectancy: null,
    } as ClientData["client"],
    accounts: [],
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: {} as ClientData["planSettings"],
    entities: [],
    familyMembers: [],
  } as unknown as ClientData;
}

describe("deriveStepStatuses", () => {
  it("marks every non-skippable step untouched on an empty tree", () => {
    const statuses = deriveStepStatuses(emptyTree(), {});
    const byslug = Object.fromEntries(statuses.map((s) => [s.slug, s]));

    expect(byslug.household.kind).toBe("untouched");
    expect(byslug.accounts.kind).toBe("untouched");
    expect(byslug["cash-flow"].kind).toBe("untouched");
    expect(byslug.review.kind).toBe("untouched");
  });

  it("marks Household complete when single-filer required fields are set", () => {
    const tree = emptyTree();
    tree.client.firstName = "Cooper";
    tree.client.lastName = "Sample";
    tree.client.dateOfBirth = "1975-06-20";
    tree.client.retirementAge = 65;
    tree.client.lifeExpectancy = 95;
    tree.client.filingStatus = "single";

    const statuses = deriveStepStatuses(tree, {});
    const household = statuses.find((s) => s.slug === "household")!;
    expect(household.kind).toBe("complete");
    expect(household.gaps).toEqual([]);
  });

  it("marks Household in_progress when partial single-filer fields are set", () => {
    const tree = emptyTree();
    tree.client.firstName = "Cooper";
    tree.client.lastName = "Sample";
    // missing DOB, retirementAge, lifeExpectancy

    const statuses = deriveStepStatuses(tree, {});
    const household = statuses.find((s) => s.slug === "household")!;
    expect(household.kind).toBe("in_progress");
    expect(household.gaps).toContain("Date of birth");
    expect(household.gaps).toContain("Retirement age");
    expect(household.gaps).toContain("Life expectancy");
  });

  it("requires spouse fields when filing jointly", () => {
    const tree = emptyTree();
    tree.client.firstName = "Cooper";
    tree.client.lastName = "Sample";
    tree.client.dateOfBirth = "1975-06-20";
    tree.client.retirementAge = 65;
    tree.client.lifeExpectancy = 95;
    tree.client.filingStatus = "joint";
    // spouse fields missing

    const statuses = deriveStepStatuses(tree, {});
    const household = statuses.find((s) => s.slug === "household")!;
    expect(household.kind).toBe("in_progress");
    expect(household.gaps).toContain("Spouse first name");
    expect(household.gaps).toContain("Spouse date of birth");
  });

  it("treats skipped steps as skipped", () => {
    const statuses = deriveStepStatuses(emptyTree(), { skippedSteps: ["family", "insurance"] });
    expect(statuses.find((s) => s.slug === "family")!.kind).toBe("skipped");
    expect(statuses.find((s) => s.slug === "insurance")!.kind).toBe("skipped");
  });

  it("does not allow skipping a non-skippable step", () => {
    const statuses = deriveStepStatuses(emptyTree(), { skippedSteps: ["accounts" as never] });
    // Accounts is non-skippable — should remain untouched, ignoring the skip flag
    expect(statuses.find((s) => s.slug === "accounts")!.kind).toBe("untouched");
  });

  it("marks Family complete when at least one non-household member exists", () => {
    const tree = emptyTree();
    (tree as unknown as { familyMembers: unknown[] }).familyMembers = [
      { id: "fm1", role: "child", firstName: "Caroline", lastName: "Sample" },
    ];
    const statuses = deriveStepStatuses(tree, {});
    expect(statuses.find((s) => s.slug === "family")!.kind).toBe("complete");
  });

  it("marks Accounts complete when at least one account exists", () => {
    const tree = emptyTree();
    tree.accounts = [{ id: "a1" } as ClientData["accounts"][number]];
    expect(deriveStepStatuses(tree, {}).find((s) => s.slug === "accounts")!.kind).toBe("complete");
  });

  it("marks Cash Flow complete only when at least one income AND one expense exist", () => {
    const tree = emptyTree();
    tree.incomes = [{ id: "i1" } as ClientData["incomes"][number]];
    expect(deriveStepStatuses(tree, {}).find((s) => s.slug === "cash-flow")!.kind).toBe("in_progress");

    tree.expenses = [{ id: "e1" } as ClientData["expenses"][number]];
    expect(deriveStepStatuses(tree, {}).find((s) => s.slug === "cash-flow")!.kind).toBe("complete");
  });

  it("marks Review complete when all non-skipped steps are complete or skipped", () => {
    const tree = emptyTree();
    tree.client.firstName = "Cooper";
    tree.client.lastName = "Sample";
    tree.client.dateOfBirth = "1975-06-20";
    tree.client.retirementAge = 65;
    tree.client.lifeExpectancy = 95;
    tree.client.filingStatus = "single";
    tree.accounts = [{ id: "a1" } as ClientData["accounts"][number]];
    tree.incomes = [{ id: "i1" } as ClientData["incomes"][number]];
    tree.expenses = [{ id: "e1" } as ClientData["expenses"][number]];

    const state: import("@/lib/onboarding/types").OnboardingState = {
      skippedSteps: ["family", "entities", "liabilities", "insurance", "estate", "assumptions"],
    };
    const statuses = deriveStepStatuses(tree, state);
    expect(statuses.find((s) => s.slug === "review")!.kind).toBe("complete");
  });
});
