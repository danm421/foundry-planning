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
      retirementMonth: 1,
      planEndAge: 0,
      lifeExpectancy: 0,
      filingStatus: "single",
      spouseName: null,
      spouseLastName: null,
      spouseDob: null,
      spouseRetirementAge: null,
      spouseLifeExpectancy: null,
    } as unknown as ClientData["client"],
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
    tree.client.filingStatus = "married_joint";
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

  it("honours a skip flag on every step, including the formerly non-skippable ones", () => {
    const statuses = deriveStepStatuses(emptyTree(), {
      skippedSteps: ["household", "accounts", "cash-flow"],
    });
    const byslug = Object.fromEntries(statuses.map((s) => [s.slug, s]));
    expect(byslug.household.kind).toBe("skipped");
    expect(byslug.accounts.kind).toBe("skipped");
    expect(byslug["cash-flow"].kind).toBe("skipped");
  });

  it("ignores a stale skip flag once the step has data", () => {
    const tree = emptyTree();
    tree.accounts = [{ id: "a1" } as ClientData["accounts"][number]];
    const statuses = deriveStepStatuses(tree, { skippedSteps: ["accounts"] });
    expect(statuses.find((s) => s.slug === "accounts")!.kind).toBe("complete");
  });

  // Liabilities is the discriminating fixture for the un-skip rule: it was
  // already skippable, so the old skip-first ordering returned "skipped" here
  // even with a liability on the tree. Accounts/cash-flow can't show this —
  // they were non-skippable, so their flag was ignored either way.
  it("ignores a stale skip flag on a step that was always skippable", () => {
    const tree = emptyTree();
    tree.liabilities = [{ id: "l1" } as ClientData["liabilities"][number]];
    const statuses = deriveStepStatuses(tree, { skippedSteps: ["liabilities"] });
    expect(statuses.find((s) => s.slug === "liabilities")!.kind).toBe("complete");
  });

  it("ignores a stale skip flag on a partially-filled step", () => {
    const tree = emptyTree();
    tree.incomes = [{ id: "i1" } as ClientData["incomes"][number]];
    const statuses = deriveStepStatuses(tree, { skippedSteps: ["cash-flow"] });
    expect(statuses.find((s) => s.slug === "cash-flow")!.kind).toBe("in_progress");
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

  it("marks Liabilities untouched on an empty tree", () => {
    const statuses = deriveStepStatuses(emptyTree(), {});
    expect(statuses.find((s) => s.slug === "liabilities")!.kind).toBe("untouched");
  });

  it("marks Liabilities complete when at least one liability exists", () => {
    const tree = emptyTree();
    tree.liabilities = [{ id: "l1" } as ClientData["liabilities"][number]];
    expect(deriveStepStatuses(tree, {}).find((s) => s.slug === "liabilities")!.kind).toBe("complete");
  });

  it("marks Liabilities skipped when state includes the slug", () => {
    const statuses = deriveStepStatuses(emptyTree(), { skippedSteps: ["liabilities"] });
    expect(statuses.find((s) => s.slug === "liabilities")!.kind).toBe("skipped");
  });

  // ── Insurance ────────────────────────────────────────────────────────────
  it("marks Insurance untouched on an empty tree", () => {
    expect(deriveStepStatuses(emptyTree(), {}).find((s) => s.slug === "insurance")!.kind).toBe("untouched");
  });

  it("marks Insurance complete when at least one life_insurance account exists", () => {
    const tree = emptyTree();
    tree.accounts = [
      { id: "a1", category: "life_insurance" } as ClientData["accounts"][number],
    ];
    expect(deriveStepStatuses(tree, {}).find((s) => s.slug === "insurance")!.kind).toBe("complete");
  });

  it("marks Insurance untouched when only non-life_insurance accounts exist", () => {
    const tree = emptyTree();
    tree.accounts = [
      { id: "a1", category: "taxable" } as ClientData["accounts"][number],
    ];
    expect(deriveStepStatuses(tree, {}).find((s) => s.slug === "insurance")!.kind).toBe("untouched");
  });

  it("marks Insurance skipped when state includes the slug", () => {
    const statuses = deriveStepStatuses(emptyTree(), { skippedSteps: ["insurance"] });
    expect(statuses.find((s) => s.slug === "insurance")!.kind).toBe("skipped");
  });

  // ── Assumptions ──────────────────────────────────────────────────────────
  it("marks Assumptions untouched until the advisor reviews it", () => {
    const status = deriveStepStatuses(emptyTree(), {}).find((s) => s.slug === "assumptions")!;
    expect(status.kind).toBe("untouched");
    expect(status.gaps).toEqual(["Not reviewed yet"]);
  });

  it("marks Assumptions complete once assumptionsReviewed is set", () => {
    const status = deriveStepStatuses(emptyTree(), { assumptionsReviewed: true })
      .find((s) => s.slug === "assumptions")!;
    expect(status.kind).toBe("complete");
    expect(status.gaps).toEqual([]);
  });

  it("does not treat a seeded residenceState as a reviewed step", () => {
    // create-client.ts seeds residenceState from the household's state, so it
    // is already set before the advisor ever opens the step.
    const tree = emptyTree();
    tree.planSettings = { residenceState: "NY" } as ClientData["planSettings"];
    const status = deriveStepStatuses(tree, {}).find((s) => s.slug === "assumptions")!;
    expect(status.kind).toBe("untouched");
  });

  it("does not treat a withdrawal strategy as a reviewed step", () => {
    // The withdrawal editor left the wizard; rows can exist from the details
    // page without the advisor having reviewed the wizard's Assumptions step.
    const tree = emptyTree();
    tree.withdrawalStrategy = [{ id: "ws1" } as unknown as ClientData["withdrawalStrategy"][number]];
    const status = deriveStepStatuses(tree, {}).find((s) => s.slug === "assumptions")!;
    expect(status.kind).toBe("untouched");
  });

  it("marks Assumptions skipped when state includes the slug", () => {
    const statuses = deriveStepStatuses(emptyTree(), { skippedSteps: ["assumptions"] });
    expect(statuses.find((s) => s.slug === "assumptions")!.kind).toBe("skipped");
  });

  // ── Goals ────────────────────────────────────────────────────────────────
  it("marks Goals untouched on an empty tree", () => {
    const status = deriveStepStatuses(emptyTree(), {}).find((s) => s.slug === "goals")!;
    expect(status.kind).toBe("untouched");
    expect(status.gaps).toEqual(["No goals added"]);
  });

  it("marks Goals complete for an education expense even without the isGoal flag", () => {
    const tree = emptyTree();
    tree.expenses = [
      { id: "e1", type: "education" } as ClientData["expenses"][number],
    ];
    expect(deriveStepStatuses(tree, {}).find((s) => s.slug === "goals")!.kind).toBe("complete");
  });

  it("marks Goals complete for a non-education expense flagged isGoal", () => {
    const tree = emptyTree();
    tree.expenses = [
      { id: "e1", type: "other", isGoal: true } as ClientData["expenses"][number],
    ];
    expect(deriveStepStatuses(tree, {}).find((s) => s.slug === "goals")!.kind).toBe("complete");
  });

  // The discriminating fixture: an ordinary expense makes Cash Flow — not
  // Goals — non-empty. Without it, "any expense at all" would pass the two
  // cases above just as well.
  it("leaves Goals untouched when the only expenses are ordinary ones", () => {
    const tree = emptyTree();
    tree.expenses = [
      { id: "e1", type: "living" } as ClientData["expenses"][number],
      { id: "e2", type: "other", isGoal: false } as ClientData["expenses"][number],
    ];
    expect(deriveStepStatuses(tree, {}).find((s) => s.slug === "goals")!.kind).toBe("untouched");
  });

  it("marks Goals skipped when state includes the slug", () => {
    const statuses = deriveStepStatuses(emptyTree(), { skippedSteps: ["goals"] });
    expect(statuses.find((s) => s.slug === "goals")!.kind).toBe("skipped");
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
      skippedSteps: ["family", "liabilities", "goals", "insurance", "assumptions"],
    };
    const statuses = deriveStepStatuses(tree, state);
    expect(statuses.find((s) => s.slug === "review")!.kind).toBe("complete");
  });
});
