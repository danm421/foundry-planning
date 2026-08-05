// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import {
  TEST_SOLO_PEOPLE,
  TEST_INCOME_ITEM,
} from "@/components/household-map/__tests__/fixtures";

// `vi.mock`'s factory is hoisted above every import, including the `const`
// below it — a plain `const loadOrganizerMap = vi.fn()` would be read by the
// factory before its own initializer runs (`ReferenceError: Cannot access
// 'loadOrganizerMap' before initialization`). `vi.hoisted()` hoists the
// declaration together with the mock call so the factory sees an initialized
// value. Mirrors `organizer-redirects.test.ts`'s mock of `permanentRedirect`.
const { loadOrganizerMap } = vi.hoisted(() => ({ loadOrganizerMap: vi.fn() }));
vi.mock("@/lib/portal/load-organizer-map", () => ({ loadOrganizerMap }));

import OrganizerCashFlowScreen from "../organizer-cash-flow-screen";

// Shared by both card-bearing tests below — one asserts the card lands in its
// owner column, the other asserts it renders inert. Identical payload in both
// cases is the point: the two tests must disagree only on what they assert.
const DATA_WITH_ITEM = {
  people: TEST_SOLO_PEOPLE,
  goals: [],
  canEdit: true,
  items: [TEST_INCOME_ITEM],
};

describe("OrganizerCashFlowScreen", () => {
  it("renders a notice when the household has no board data", async () => {
    loadOrganizerMap.mockResolvedValue(null);
    const { container } = render(await OrganizerCashFlowScreen({ clientId: "c1" }));
    expect(container.textContent).toContain("advisor");
    expect(container.querySelector("[data-testid^='band-']")).toBeNull();
  });

  it("places a card in its owner column", async () => {
    loadOrganizerMap.mockResolvedValue(DATA_WITH_ITEM);
    const { getByTestId } = render(await OrganizerCashFlowScreen({ clientId: "c1" }));
    expect(getByTestId("band-income-column-client").textContent).toContain("Salary");
  });

  it("offers no add or edit affordance, even when canEdit is true", async () => {
    loadOrganizerMap.mockResolvedValue(DATA_WITH_ITEM);
    const { container } = render(await OrganizerCashFlowScreen({ clientId: "c1" }));
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});
