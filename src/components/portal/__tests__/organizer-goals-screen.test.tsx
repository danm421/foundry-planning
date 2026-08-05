// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import {
  TEST_SOLO_PEOPLE,
  TEST_PURCHASE_GOAL,
} from "@/components/household-map/__tests__/fixtures";

// `vi.mock`'s factory is hoisted above every import, including the `const`
// below it — a plain `const loadOrganizerMap = vi.fn()` would be read by the
// factory before its own initializer runs (`ReferenceError: Cannot access
// 'loadOrganizerMap' before initialization`). `vi.hoisted()` hoists the
// declaration together with the mock call so the factory sees an initialized
// value. Mirrors `organizer-redirects.test.ts`'s mock of `permanentRedirect`.
const { loadOrganizerMap } = vi.hoisted(() => ({ loadOrganizerMap: vi.fn() }));
vi.mock("@/lib/portal/load-organizer-map", () => ({ loadOrganizerMap }));

import OrganizerGoalsScreen from "../organizer-goals-screen";

// Shared by both goal-bearing tests below — one asserts the row renders, the
// other asserts it renders inert. Identical `loadOrganizerMap` payload in both
// cases is the point: the two tests must disagree only on what they assert.
const DATA_WITH_GOAL = {
  people: TEST_SOLO_PEOPLE,
  items: [],
  canEdit: true,
  goals: [TEST_PURCHASE_GOAL],
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
  });

  it("never renders an editable goal card, even when canEdit is true", async () => {
    loadOrganizerMap.mockResolvedValue(DATA_WITH_GOAL);
    const { container } = render(await OrganizerGoalsScreen({ clientId: "c1" }));
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});
