// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ComparisonChangesDrawer,
  type ComparisonChangesDrawerPlan,
} from "../comparison-changes-drawer";
import type { ChangesPanelChange } from "@/components/scenario/changes-panel";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

function makeChange(overrides: Partial<ChangesPanelChange> = {}): ChangesPanelChange {
  return {
    id: `c-${Math.random().toString(36).slice(2)}`,
    scenarioId: "s-1",
    opType: "add",
    targetKind: "income",
    targetId: "00000000-aaaa-bbbb-cccc-000000000001",
    payload: { name: "Side income" },
    toggleGroupId: null,
    orderIndex: 0,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    enabled: true,
    ...overrides,
  };
}

function makePlan(overrides: Partial<ComparisonChangesDrawerPlan> = {}): ComparisonChangesDrawerPlan {
  return {
    scenarioId: "s-1",
    scenarioName: "Plan One",
    label: "Plan One",
    changes: [makeChange()],
    toggleGroups: [],
    cascadeWarnings: [],
    targetNames: {},
    ...overrides,
  };
}

describe("ComparisonChangesDrawer", () => {
  beforeEach(() => {
    refreshMock.mockClear();
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ) as typeof fetch;
  });

  it("renders nothing when there are no plans", () => {
    const { container } = render(
      <ComparisonChangesDrawer
        clientId="c-1"
        open={true}
        onClose={() => {}}
        activeTab={0}
        onTabChange={() => {}}
        plans={[]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders one tab per plan and the active tab's panel", () => {
    const planA = makePlan({ scenarioId: "s-a", label: "Plan A", scenarioName: "Scenario A" });
    const planB = makePlan({ scenarioId: "s-b", label: "Plan B", scenarioName: "Scenario B" });
    render(
      <ComparisonChangesDrawer
        clientId="c-1"
        open={true}
        onClose={() => {}}
        activeTab={0}
        onTabChange={() => {}}
        plans={[planA, planB]}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
    // The active tab's scoped ChangesPanel renders the scenario name in its
    // header — use a distinct scenario name to avoid colliding with the tab label.
    expect(screen.getByText("Scenario A")).toBeInTheDocument();
    expect(screen.queryByText("Scenario B")).not.toBeInTheDocument();
  });

  it("clicking a tab calls onTabChange with that index", () => {
    const onTabChange = vi.fn();
    render(
      <ComparisonChangesDrawer
        clientId="c-1"
        open={true}
        onClose={() => {}}
        activeTab={0}
        onTabChange={onTabChange}
        plans={[
          makePlan({ scenarioId: "s-a", label: "Plan A" }),
          makePlan({ scenarioId: "s-b", label: "Plan B" }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Plan B" }));
    expect(onTabChange).toHaveBeenCalledWith(1);
  });

  it("Escape key triggers onClose when open", () => {
    const onClose = vi.fn();
    render(
      <ComparisonChangesDrawer
        clientId="c-1"
        open={true}
        onClose={onClose}
        activeTab={0}
        onTabChange={() => {}}
        plans={[makePlan()]}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape is a no-op when the drawer is closed", () => {
    const onClose = vi.fn();
    render(
      <ComparisonChangesDrawer
        clientId="c-1"
        open={false}
        onClose={onClose}
        activeTab={0}
        onTabChange={() => {}}
        plans={[makePlan()]}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("clicking the backdrop triggers onClose", () => {
    const onClose = vi.fn();
    render(
      <ComparisonChangesDrawer
        clientId="c-1"
        open={true}
        onClose={onClose}
        activeTab={0}
        onTabChange={() => {}}
        plans={[makePlan()]}
      />,
    );
    fireEvent.click(screen.getByTestId("comparison-changes-drawer-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("close button triggers onClose", () => {
    const onClose = vi.fn();
    render(
      <ComparisonChangesDrawer
        clientId="c-1"
        open={true}
        onClose={onClose}
        activeTab={0}
        onTabChange={() => {}}
        plans={[makePlan()]}
      />,
    );
    fireEvent.click(screen.getByLabelText("Close changes drawer"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clamps an out-of-range activeTab to a valid index", () => {
    render(
      <ComparisonChangesDrawer
        clientId="c-1"
        open={true}
        onClose={() => {}}
        activeTab={99}
        onTabChange={() => {}}
        plans={[makePlan({ label: "Plan A" }), makePlan({ scenarioId: "s-b", label: "Plan B" })]}
      />,
    );
    // Last plan should be selected when activeTab overshoots.
    const tabs = screen.getAllByRole("tab");
    expect(tabs[tabs.length - 1]).toHaveAttribute("aria-selected", "true");
  });
});
