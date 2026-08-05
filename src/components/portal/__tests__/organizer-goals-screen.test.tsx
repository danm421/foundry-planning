// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
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

import OrganizerGoalsScreen from "../organizer-goals-screen";

/**
 * Cooper's life-expectancy milestone — `buildMapBoards` emits one of these for
 * EVERY real household (`lifeExpectancyMilestones` in
 * `@/lib/household-map/goals`), so it is the common card, not an edge case.
 * Year is 1976 + 90, matching `TEST_SOLO_PEOPLE`'s `birthYear`.
 *
 * It is here rather than beside the purchase goal because it is the only card
 * shape that reaches `GoalsBoard`'s `detailSlotFor` — the `InlineAmount` age
 * editor, one of the two affordances a purchase-goal-only fixture leaves
 * completely unexercised (the other being the "Add goal" button).
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

// Shared by both goal-bearing tests below — one asserts the row renders, the
// other asserts it renders inert. Identical `loadOrganizerMap` payload in both
// cases is the point: the two tests must disagree only on what they assert.
const DATA_WITH_GOAL = {
  people: TEST_SOLO_PEOPLE,
  items: [],
  canEdit: true,
  goals: [TEST_PURCHASE_GOAL, TEST_LIFE_EXPECTANCY_GOAL],
};

describe("OrganizerGoalsScreen", () => {
  it("renders a notice when the household has no board data", async () => {
    loadOrganizerMap.mockResolvedValue(null);
    const { container } = render(await OrganizerGoalsScreen({ clientId: "c1" }));
    expect(container.textContent).toContain("advisor");
    expect(container.querySelector("[data-testid^='goal-row-']")).toBeNull();
  });

  it("renders one row per goal", async () => {
    loadOrganizerMap.mockResolvedValue(DATA_WITH_GOAL);
    const { getByTestId } = render(await OrganizerGoalsScreen({ clientId: "c1" }));
    expect(getByTestId("goal-row-expense:e1").textContent).toContain("New roof");
    // Also what keeps the assertion below honest: a life-expectancy card that
    // silently stopped rendering would make the zero-button count vacuous again.
    expect(getByTestId("goal-row-milestone:client_life_expectancy").textContent).toContain(
      "age 90",
    );
  });

  // Every affordance `GoalsBoard` can draw is in scope here, which is why the
  // fixture carries a life-expectancy card as well as a purchase goal: the
  // "Add goal" button (`canEdit && onAddGoal`) and the age editor
  // (`canEdit && onSaveLifeExpectancy`) are the two the purchase goal alone
  // cannot reach, and the age editor needs a `lifeExpectancy` card to hang off.
  it("never renders an editable goal card, even when canEdit is true", async () => {
    loadOrganizerMap.mockResolvedValue(DATA_WITH_GOAL);
    const { container } = render(await OrganizerGoalsScreen({ clientId: "c1" }));
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});
