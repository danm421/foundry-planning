// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  TEST_SOLO_PEOPLE,
  TEST_PURCHASE_GOAL,
} from "@/components/household-map/__tests__/fixtures";
import type { MapGoal } from "@/lib/household-map/goals";

// `vi.mock`'s factory is hoisted above every import, including the `const`
// below it — a plain `const loadOrganizerMap = vi.fn()` would be read by the
// factory before its own initializer runs (`ReferenceError: Cannot access
// 'loadOrganizerMap' before initialization`). `vi.hoisted()` hoists the
// declaration together with the mock call so the factory sees an initialized
// value. Mirrors `organizer-redirects.test.ts`'s mock of `permanentRedirect`.
const { loadOrganizerMap } = vi.hoisted(() => ({ loadOrganizerMap: vi.fn() }));
vi.mock("@/lib/portal/load-organizer-map", () => ({ loadOrganizerMap }));
// The screen now returns a client component, and the panel it can open uses
// the router.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import OrganizerGoalsScreen from "../organizer-goals-screen";

/**
 * Cooper's life-expectancy milestone — `buildMapBoards` emits one of these for
 * EVERY real household (`lifeExpectancyMilestones` in
 * `@/lib/household-map/goals`), so it is the common card, not an edge case.
 * Year is 1976 + 90, matching `TEST_SOLO_PEOPLE`'s `birthYear`.
 *
 * It is here rather than beside the purchase goal because it is the only card
 * shape that reaches `GoalsBoard`'s `detailSlotFor` — the `InlineAmount` age
 * editor, which the portal must never render.
 */
const TEST_LIFE_EXPECTANCY_GOAL: MapGoal = {
  id: "milestone:client_life_expectancy",
  year: 2066,
  kind: "life_expectancy",
  side: "client",
  title: "Cooper's life expectancy",
  detail: "age 90",
  expenseId: null,
  forFamilyMemberName: null,
  lifeExpectancy: { owner: "client", age: 90, assumed: false },
};

const MILESTONES = {
  planStart: 2026,
  planEnd: 2070,
  clientRetirement: 2040,
  clientEnd: 2070,
};

const DATA = {
  people: TEST_SOLO_PEOPLE,
  items: [],
  canEdit: true,
  goals: [TEST_PURCHASE_GOAL, TEST_LIFE_EXPECTANCY_GOAL],
  incomeRows: {},
  // TEST_PURCHASE_GOAL is backed by expense e1. Membership here is what makes
  // its card clickable; the life-expectancy milestone has expenseId null and
  // can never be in this map.
  expenseRows: {
    e1: { id: "e1", name: "New roof", annualAmount: "40000", startYear: 2030, endYear: 2030, type: "other", growthRate: "0.03", isGoal: true },
  },
  savingsRuleRows: {},
  savingsAccountOptions: [{ id: "acct-1", name: "Joint Brokerage" }],
  familyMemberOptions: [],
  milestones: MILESTONES,
  resolvedInflationRate: 0.03,
};

beforeEach(() => {
  vi.clearAllMocks();
  loadOrganizerMap.mockResolvedValue(DATA);
  document.body.innerHTML = "";
});

describe("OrganizerGoalsScreen", () => {
  it("renders a notice when the household has no board data", async () => {
    loadOrganizerMap.mockResolvedValue(null);
    const { container } = render(await OrganizerGoalsScreen({ clientId: "c1" }));
    expect(container.textContent).toContain("advisor");
    expect(container.querySelector("[data-testid^='goal-row-']")).toBeNull();
  });

  it("renders one row per goal", async () => {
    const { getByTestId } = render(await OrganizerGoalsScreen({ clientId: "c1" }));
    expect(getByTestId("goal-row-expense:e1").textContent).toContain("New roof");
    expect(getByTestId("goal-row-milestone:client_life_expectancy").textContent).toContain(
      "age 90",
    );
  });

  it("renders the header Add goal button when editing is enabled", async () => {
    render(await OrganizerGoalsScreen({ clientId: "c1" }));
    expect(screen.getByRole("button", { name: "Add goal" })).toBeInTheDocument();
  });

  it("renders exactly ONE Add goal button, not the board's as well", async () => {
    render(await OrganizerGoalsScreen({ clientId: "c1" }));
    expect(screen.getAllByRole("button", { name: "Add goal" })).toHaveLength(1);
  });

  it("renders no Add goal button when the advisor has editing off", async () => {
    loadOrganizerMap.mockResolvedValue({ ...DATA, canEdit: false });
    render(await OrganizerGoalsScreen({ clientId: "c1" }));
    expect(screen.queryByRole("button", { name: "Add goal" })).not.toBeInTheDocument();
  });

  it("makes an expense-backed goal card clickable", async () => {
    document.body.innerHTML = '<aside id="portal-detail"></aside>';
    render(await OrganizerGoalsScreen({ clientId: "c1" }));
    fireEvent.click(screen.getByTestId("goal-card-joint-expense:e1"));
    expect(await screen.findByRole("heading", { name: "Edit expense" })).toBeInTheDocument();
  });

  it("leaves life-expectancy milestones inert and offers no age editor", async () => {
    // These cards move the plan horizon. Advisor lever — the board must fall
    // back to its static detail line.
    render(await OrganizerGoalsScreen({ clientId: "c1" }));
    const card = screen.getByTestId("goal-card-left-milestone:client_life_expectancy");
    expect(card.tagName).toBe("DIV");
    expect(screen.queryByRole("button", { name: /life expectancy/i })).not.toBeInTheDocument();
  });

  it("opens the panel with 'Show as a goal' pre-ticked from Add goal", async () => {
    document.body.innerHTML = '<aside id="portal-detail"></aside>';
    render(await OrganizerGoalsScreen({ clientId: "c1" }));
    fireEvent.click(screen.getByRole("button", { name: "Add goal" }));
    expect(await screen.findByLabelText("Show as a goal")).toBeChecked();
  });
});
