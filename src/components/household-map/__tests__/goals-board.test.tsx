// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import GoalsBoard from "../goals-board";
import type { GoalKind, MapGoal } from "@/lib/household-map/goals";
import { categoryDefaultRates as buildCategoryDefaultRates } from "@/lib/investments/category-default-rates";
import type { HouseholdMapProps, MapPerson } from "@/lib/household-map/types";

function person(overrides: Partial<MapPerson> = {}): MapPerson {
  return {
    familyMemberId: "fm-default",
    firstName: "Alex",
    age: 45,
    retirementYear: 2045,
    birthYear: 1980,
    ...overrides,
  };
}

function goal(overrides: Partial<MapGoal> & Pick<MapGoal, "id">): MapGoal {
  return {
    year: 2030,
    kind: "household",
    side: "client",
    title: "Goal title",
    detail: null,
    expenseId: null,
    forFamilyMemberName: null,
    ...overrides,
  };
}

function baseProps(overrides: Partial<HouseholdMapProps> = {}): HouseholdMapProps {
  return {
    clientId: "client-1",
    people: {
      client: person({ familyMemberId: "fm-client", firstName: "Alex" }),
      spouse: person({ familyMemberId: "fm-spouse", firstName: "Jordan", birthYear: 1982 }),
      children: [],
    },
    netWorthLabel: "$500,000",
    items: [],
    goals: [],
    canEdit: true,
    // Editor hydration rows (see HouseholdMapProps). Empty by default — these
    // boards render cards, they don't hydrate editors.
    incomeRows: {},
    expenseRows: {},
    savingsRuleRows: {},
    savingsSchedules: {},
    flowScenarioFields: {},
    accountOptions: [],
    // Required on `HouseholdMapProps` as of Task 5. This board does not read
    // either one — they are here so the fixture typechecks against the shared
    // props type, which is the point of having a shared props type.
    accountRows: {},
    growthContext: {
      modelPortfolios: [],
      fundPortfolios: [],
      resolvedInflationRate: 0.025,
      categoryDefaults: {},
    },
    // The real fallback map (all ten categories) rather than a hand-rolled
    // literal — `CategoryDefaultRateMap` requires every key, and calling the
    // shipped function keeps the fixture honest if those defaults ever move.
    categoryDefaultRates: buildCategoryDefaultRates(undefined, [], 0),
    assetClassOptions: [],
    portfolioAllocationsMap: {},
    categoryDefaultSources: {},
    businessOptions: [],
    rothIraAccountOptions: [],
    resolvedInflationRate: 0.03,
    familyMemberOptions: [],
    entityOptions: [],
    ...overrides,
  };
}

describe("GoalsBoard", () => {
  it("places a client-side goal in the left cell and a spouse-side goal in the right cell", () => {
    const clientGoal = goal({ id: "g-client", side: "client", year: 2030, title: "Alex retires" });
    const spouseGoal = goal({ id: "g-spouse", side: "spouse", year: 2032, title: "Jordan retires" });

    render(<GoalsBoard {...baseProps({ goals: [clientGoal, spouseGoal] })} />);

    const clientRow = screen.getByTestId(`goal-row-${clientGoal.id}`);
    expect(clientRow.children).toHaveLength(3);
    expect(
      within(clientRow.children[0] as HTMLElement).getByText("Alex retires"),
    ).toBeInTheDocument();
    // Right cell of the client-side row must stay empty — the card did not
    // leak to the wrong side of the spine.
    expect(clientRow.children[2].textContent).toBe("");

    const spouseRow = screen.getByTestId(`goal-row-${spouseGoal.id}`);
    expect(spouseRow.children[0].textContent).toBe("");
    expect(
      within(spouseRow.children[2] as HTMLElement).getByText("Jordan retires"),
    ).toBeInTheDocument();
  });

  it("renders a joint goal as its own full-width straddling row, not dropped", () => {
    const jointGoal = goal({ id: "g-joint", side: "joint", year: 2028, title: "New roof" });

    render(<GoalsBoard {...baseProps({ goals: [jointGoal] })} />);

    const row = screen.getByTestId(`goal-row-${jointGoal.id}`);
    // A joint goal must NOT fall into the client/spouse two-cell grid row —
    // that layout has no cell for "joint" and would silently drop the card.
    expect(row.className).not.toContain("grid-cols-[1fr_88px_1fr]");
    expect(within(row).getByText("New roof")).toBeInTheDocument();
    expect(within(row).getByTestId(`goal-card-joint-${jointGoal.id}`)).toBeInTheDocument();
  });

  it("agesAt derives ages from each person's birthYear, per goal year — not a Date computed in the component", () => {
    const earlyGoal = goal({ id: "g-early", side: "client", year: 2026, title: "Early goal" });
    const laterGoal = goal({ id: "g-later", side: "client", year: 2030, title: "Later goal" });

    render(
      <GoalsBoard
        {...baseProps({
          people: {
            // `age` is a deliberately nonsense placeholder distinct from any
            // birthYear-derived value, so a passing assertion below can only
            // mean the ages line reads `birthYear`, not `age`.
            client: person({ birthYear: 1961, age: 999 }),
            spouse: person({ birthYear: 1963, firstName: "Jordan", age: 999 }),
            children: [],
          },
          goals: [earlyGoal, laterGoal],
        })}
      />,
    );

    // 2026 - 1961 = 65, 2026 - 1963 = 63.
    expect(
      within(screen.getByTestId(`goal-row-${earlyGoal.id}`)).getByText("65 / 63"),
    ).toBeInTheDocument();
    // 2030 - 1961 = 69, 2030 - 1963 = 67 — a different row, a different year,
    // a different pair of ages. A component reading `new Date()` instead of
    // the row's own `year` would render the same ages on both rows.
    expect(
      within(screen.getByTestId(`goal-row-${laterGoal.id}`)).getByText("69 / 67"),
    ).toBeInTheDocument();
  });

  it("single client (people.spouse === null) — ages render without a spouse age or a slash", () => {
    const g = goal({ id: "g-single", side: "client", year: 2026, title: "Solo goal" });

    render(
      <GoalsBoard
        {...baseProps({
          people: { client: person({ birthYear: 1961 }), spouse: null, children: [] },
          goals: [g],
        })}
      />,
    );

    const row = screen.getByTestId(`goal-row-${g.id}`);
    expect(within(row).getByText("65")).toBeInTheDocument();
    expect(within(row).queryByText(/\//)).not.toBeInTheDocument();
  });

  // The hint is gated on real, expense-backed goals rather than a card count.
  // A count threshold showed it to an unmarried household (two milestones) even
  // once that household had a genuine goal, and hid it from a married household
  // with three milestones and none.
  it("renders the hint while there are only life milestones, however many", () => {
    const milestonesOnly = [
      goal({ id: "g1", year: 2026 }),
      goal({ id: "g2", year: 2027 }),
      goal({ id: "g3", year: 2028 }),
      goal({ id: "g4", year: 2029 }),
    ];
    render(<GoalsBoard {...baseProps({ goals: milestonesOnly })} />);
    expect(
      screen.getByText("Tick “Show as a goal” on any expense to add it here."),
    ).toBeInTheDocument();
  });

  it("hides the hint as soon as ONE expense-backed goal exists, even in a two-card household", () => {
    const goals = [goal({ id: "g1", year: 2026 }), goal({ id: "g2", year: 2027, expenseId: "exp-1" })];
    render(<GoalsBoard {...baseProps({ goals })} />);
    expect(
      screen.queryByText("Tick “Show as a goal” on any expense to add it here."),
    ).not.toBeInTheDocument();
  });

  it("renders the beneficiary name so two children's identical goals are distinguishable", () => {
    const goals = [
      goal({ id: "g-kelly", year: 2040, title: "College", forFamilyMemberName: "Kelly" }),
      goal({ id: "g-sam", year: 2043, title: "College", forFamilyMemberName: "Sam" }),
    ];
    render(<GoalsBoard {...baseProps({ goals })} />);

    expect(
      within(screen.getByTestId("goal-row-g-kelly")).getByText("for Kelly"),
    ).toBeInTheDocument();
    expect(within(screen.getByTestId("goal-row-g-sam")).getByText("for Sam")).toBeInTheDocument();
  });

  // Same writability test the Cash Flow board applies via `isItemEditable`:
  // `handleEditGoalExpense` already refuses to open the drawer for an expense
  // with no hydration row, so without this the card looks clickable and
  // silently does nothing.
  it("a goal whose expense has no hydration row is not a button", () => {
    const g = goal({ id: "g-orphan", expenseId: "exp-gone", title: "Orphaned goal" });
    render(<GoalsBoard {...baseProps({ goals: [g] })} />);

    expect(screen.queryByRole("button", { name: /Orphaned goal/ })).not.toBeInTheDocument();
  });

  it("a goal whose expense DOES have a hydration row is a button", () => {
    const g = goal({ id: "g-live", expenseId: "exp-1", title: "New roof" });
    render(
      <GoalsBoard
        {...baseProps({
          goals: [g],
          expenseRows: {
            "exp-1": {
              id: "exp-1",
              type: "other",
              name: "New roof",
              annualAmount: "20000",
              startYear: 2030,
              endYear: 2030,
              growthRate: "0.03",
            },
          },
        })}
      />,
    );

    expect(screen.getByRole("button", { name: /New roof/ })).toBeInTheDocument();
  });

  const KIND_CASES: { kind: GoalKind; label: string; border: string }[] = [
    { kind: "education", label: "Education", border: "var(--color-cat-portfolio)" },
    { kind: "purchase", label: "Purchase", border: "var(--color-crit)" },
    { kind: "household", label: "Household", border: "var(--color-cat-transactions)" },
    { kind: "retirement", label: "Retirement", border: "var(--color-cat-income)" },
    { kind: "plan_end", label: "Plan end", border: "var(--color-cat-life)" },
  ];

  it.each(KIND_CASES)(
    "kind '$kind' gets its own label and accent border colour",
    ({ kind, label, border }) => {
      const g = goal({ id: `g-${kind}`, kind, side: "client", title: `Title for ${kind}` });
      render(<GoalsBoard {...baseProps({ goals: [g] })} />);

      const card = screen.getByTestId(`goal-card-left-${g.id}`);
      expect(within(card).getByText(label)).toBeInTheDocument();
      expect(card.style.borderColor).toBe(border);
    },
  );
});
