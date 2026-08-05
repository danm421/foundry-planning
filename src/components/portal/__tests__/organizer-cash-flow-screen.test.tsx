// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// `vi.mock`'s factory is hoisted above every import, including the `const`
// below it — a plain `const loadOrganizerMap = vi.fn()` would be read by the
// factory before its own initializer runs (`ReferenceError: Cannot access
// 'loadOrganizerMap' before initialization`). `vi.hoisted()` hoists the
// declaration together with the mock call so the factory sees an initialized
// value. Mirrors `organizer-redirects.test.ts`'s mock of `permanentRedirect`.
const { loadOrganizerMap } = vi.hoisted(() => ({ loadOrganizerMap: vi.fn() }));
vi.mock("@/lib/portal/load-organizer-map", () => ({ loadOrganizerMap }));

import OrganizerCashFlowScreen from "../organizer-cash-flow-screen";

const CLIENT = {
  familyMemberId: "fm-1",
  firstName: "Cooper",
  age: 50,
  retirementYear: 2040,
  birthYear: 1976,
};

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "i1",
    kind: "income",
    category: "investments",
    name: "Salary",
    valueLabel: "$200,000",
    value: 200000,
    column: "client",
    splitChip: null,
    trayOwnerLabel: null,
    noteChip: null,
    timing: null,
    editableAmount: 200000,
    ...overrides,
  };
}

describe("OrganizerCashFlowScreen", () => {
  it("renders a notice when the household has no board data", async () => {
    loadOrganizerMap.mockResolvedValue(null);
    const { container } = render(await OrganizerCashFlowScreen({ clientId: "c1" }));
    expect(container.textContent).toContain("advisor");
    expect(container.querySelector("[data-testid^='band-']")).toBeNull();
  });

  it("places a card in its owner column", async () => {
    loadOrganizerMap.mockResolvedValue({
      people: { client: CLIENT, spouse: null, children: [] },
      goals: [],
      canEdit: true,
      items: [item()],
    });
    const { getByTestId } = render(await OrganizerCashFlowScreen({ clientId: "c1" }));
    expect(getByTestId("band-income-column-client").textContent).toContain("Salary");
  });

  it("offers no add or edit affordance, even when canEdit is true", async () => {
    loadOrganizerMap.mockResolvedValue({
      people: { client: CLIENT, spouse: null, children: [] },
      goals: [],
      canEdit: true,
      items: [item()],
    });
    const { container } = render(await OrganizerCashFlowScreen({ clientId: "c1" }));
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});
