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
  goals: { clientRetirementAge: 65, expenseGoals: [], topics: [] },
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
        { name: "Fidelity", category: "taxable", value: 100000, owner: "client" },
        { name: "Roth", category: "retirement", value: 50000, owner: "spouse" },
      ],
    };
    const diff = buildIntakeDiff(null, withAccounts);
    expect(diff.accounts.submittedCount).toBe(2);
    expect(diff.accounts.submittedItems[0].name).toBe("Fidelity");
  });

  it("surfaces owner and tax basis so the advisor approves what apply will write", () => {
    const withAccounts: IntakePayload = {
      ...minPayload,
      accounts: [
        { name: "Joint Brokerage", category: "taxable", value: 100000, basis: 60000, owner: "joint" },
        { name: "Checking", category: "cash", value: 5000, owner: "client" },
      ],
    };
    const diff = buildIntakeDiff(null, withAccounts);
    expect(diff.accounts.submittedItems[0].secondary).toBe("taxable · joint · basis $60,000");
    // No basis collected → nothing to show for it.
    expect(diff.accounts.submittedItems[1].secondary).toBe("cash · client");
  });

  it("surfaces the income owner so the advisor approves whose income it is", () => {
    const withIncome: IntakePayload = {
      ...minPayload,
      income: [
        {
          name: "Consulting",
          type: "business",
          annualAmount: 40000,
          owner: "spouse",
          startYear: 2026,
          endYear: 2035,
          endsAtRetirement: false,
        },
        {
          name: "Day job",
          type: "salary",
          annualAmount: 120000,
          owner: "client",
          startYear: 2026,
          endYear: 2040,
          endsAtRetirement: false,
        },
      ],
    };
    const diff = buildIntakeDiff(null, withIncome);
    expect(diff.income.submittedItems[0].secondary).toBe("business · spouse · 2026 – 2035");
    expect(diff.income.submittedItems[1].secondary).toBe("salary · client · 2026 – 2040");
  });

  it("shows a retirement-anchored income as its anchor, not a frozen year", () => {
    const withIncome: IntakePayload = {
      ...minPayload,
      income: [
        {
          name: "Day job",
          type: "salary",
          annualAmount: 120000,
          owner: "client",
          startYear: 2026,
          endsAtRetirement: true,
        },
      ],
    };
    const diff = buildIntakeDiff(null, withIncome);
    expect(diff.income.submittedItems[0].secondary).toBe("salary · client · 2026 – retirement");
  });

  it("detects goals retirement age change", () => {
    const updated: IntakePayload = {
      ...minPayload,
      goals: { clientRetirementAge: 60, expenseGoals: [], topics: [] },
    };
    const diff = buildIntakeDiff(minPayload, updated);
    expect(diff.goals.clientRetirementAge).toEqual({ changed: true, old: 65, new: 60 });
  });

  it("handles missing spouse gracefully", () => {
    const diff = buildIntakeDiff(null, minPayload);
    expect(diff.family.spouseName).toEqual({ changed: false, value: undefined });
  });

  it("surfaces a funded goal's type, beneficiary, and span", () => {
    const withGoal: IntakePayload = {
      ...minPayload,
      family: {
        ...minPayload.family,
        children: [{ firstName: "Emma", dateOfBirth: "2014-03-02" }],
      },
      goals: {
        ...minPayload.goals,
        expenseGoals: [
          {
            name: "Emma's college",
            type: "education",
            amount: 40000,
            startYear: 2034,
            years: 4,
            // A structural ref, resolved back to a name against the same
            // payload's family — so a rename can't orphan the attribution.
            forWhom: "child:0",
          },
        ],
      },
    };
    const diff = buildIntakeDiff(null, withGoal);
    expect(diff.expenseGoals.submittedCount).toBe(1);
    expect(diff.expenseGoals.submittedItems[0]).toEqual({
      name: "Emma's college",
      value: 40000,
      secondary: "Education · for Emma · 2034–2037",
    });
  });

  it("omits the beneficiary when the ref points at a child no longer listed", () => {
    const withGoal: IntakePayload = {
      ...minPayload,
      goals: {
        ...minPayload.goals,
        expenseGoals: [
          { name: "College", type: "education", amount: 40000, startYear: 2034, years: 4, forWhom: "child:3" },
        ],
      },
    };
    const diff = buildIntakeDiff(null, withGoal);
    // A stale name would be worse than none — the advisor sees the goal, just
    // not an attribution the family no longer supports.
    expect(diff.expenseGoals.submittedItems[0].secondary).toBe("Education · 2034–2037");
  });

  it("shows a one-time goal as a single year, and a blank start year as this one", () => {
    const currentYear = new Date().getFullYear();
    const withGoal: IntakePayload = {
      ...minPayload,
      goals: {
        ...minPayload.goals,
        expenseGoals: [{ name: "Wedding", type: "wedding", amount: 45000, years: 1 }],
      },
    };
    const diff = buildIntakeDiff(null, withGoal);
    // No start year given — apply fills in the current year, so the diff must
    // show the year the advisor is actually approving.
    expect(diff.expenseGoals.submittedItems[0].secondary).toBe(
      `Wedding · ${currentYear}`,
    );
  });

  it("resolves discussion topics to the labels the client read", () => {
    const withTopics: IntakePayload = {
      ...minPayload,
      goals: {
        ...minPayload.goals,
        topics: ["charitable", "care"],
        topicsNote: "  Thinking about a cabin.  ",
      },
    };
    const diff = buildIntakeDiff(null, withTopics);
    expect(diff.radar.topics).toEqual([
      "Charitable giving",
      "Long-term care, for us or a parent",
    ]);
    expect(diff.radar.note).toBe("Thinking about a cabin.");
  });

  it("drops a whitespace-only note so the review card stays hidden", () => {
    const withBlankNote: IntakePayload = {
      ...minPayload,
      goals: { ...minPayload.goals, topicsNote: "   " },
    };
    expect(buildIntakeDiff(null, withBlankNote).radar.note).toBeUndefined();
  });
});
