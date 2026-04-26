// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ChangesPanel,
  type ChangesPanelChange,
} from "@/components/scenario/changes-panel";
import type { CascadeWarning, ToggleGroup } from "@/engine/scenario/types";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

function makeChange(overrides: Partial<ChangesPanelChange> = {}): ChangesPanelChange {
  return {
    id: "c-1",
    scenarioId: "s-1",
    opType: "add",
    targetKind: "income",
    targetId: "11111111-2222-3333-4444-555555555555",
    payload: { name: "Side income" },
    toggleGroupId: null,
    orderIndex: 0,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("ChangesPanel", () => {
  beforeEach(() => {
    refreshMock.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders header with scenario name + counts", () => {
    render(
      <ChangesPanel
        clientId="c1"
        scenarioId="s1"
        scenarioName="Roth ladder 2027"
        changes={[makeChange(), makeChange({ id: "c-2" })]}
        toggleGroups={[
          {
            id: "g-1",
            scenarioId: "s1",
            name: "Roth conversions",
            defaultOn: true,
            requiresGroupId: null,
            orderIndex: 0,
          },
        ] as ToggleGroup[]}
        cascadeWarnings={[]}
      />,
    );
    expect(screen.getByText("Roth ladder 2027")).toBeInTheDocument();
    expect(screen.getByText(/2 changes · 1 toggle group/)).toBeInTheDocument();
  });

  it("renders empty state when no changes", () => {
    render(
      <ChangesPanel
        clientId="c1"
        scenarioId="s1"
        scenarioName="Empty"
        changes={[]}
        toggleGroups={[]}
        cascadeWarnings={[]}
      />,
    );
    expect(screen.getByText(/No changes yet/)).toBeInTheDocument();
    expect(screen.getByText(/0 changes · 0 toggle groups/)).toBeInTheDocument();
  });

  it("renders ungrouped section with leaf rows when changes exist (filters toggleGroupId == null)", () => {
    const ungrouped = makeChange({ id: "c-ungrouped" });
    const grouped = makeChange({ id: "c-grouped", toggleGroupId: "g-1" });
    render(
      <ChangesPanel
        clientId="c1"
        scenarioId="s1"
        scenarioName="Mixed"
        changes={[ungrouped, grouped]}
        toggleGroups={[]}
        cascadeWarnings={[]}
      />,
    );
    expect(screen.getByText(/UNGROUPED — 1/)).toBeInTheDocument();
    expect(screen.getByTestId("leaf-row-c-ungrouped")).toBeInTheDocument();
    expect(screen.queryByTestId("leaf-row-c-grouped")).not.toBeInTheDocument();
  });

  it("CascadeWarnings chip renders only when warnings.length > 0", () => {
    const { rerender } = render(
      <ChangesPanel
        clientId="c1"
        scenarioId="s1"
        scenarioName="No warnings"
        changes={[]}
        toggleGroups={[]}
        cascadeWarnings={[]}
      />,
    );
    expect(screen.queryByTestId("cascade-warnings-chip")).not.toBeInTheDocument();

    const warning: CascadeWarning = {
      kind: "transfer_dropped",
      message: "Transfer dropped",
      causedByChangeId: "c-1",
      affectedEntityId: "t-1",
      affectedEntityLabel: "Transfer · 2027",
    };
    rerender(
      <ChangesPanel
        clientId="c1"
        scenarioId="s1"
        scenarioName="With warnings"
        changes={[]}
        toggleGroups={[]}
        cascadeWarnings={[warning]}
      />,
    );
    expect(screen.getByTestId("cascade-warnings-chip")).toHaveTextContent(
      /1 CASCADE WARNING/,
    );
  });

  it("renders Group button in panel header", () => {
    render(
      <ChangesPanel
        clientId="cl-1"
        scenarioId="sc-1"
        scenarioName="What if"
        changes={[]}
        toggleGroups={[]}
        cascadeWarnings={[]}
      />,
    );
    expect(screen.getByRole("button", { name: /^group$/i })).toBeTruthy();
  });

  it("clicking Group button switches the panel into editor mode", () => {
    render(
      <ChangesPanel
        clientId="cl-1"
        scenarioId="sc-1"
        scenarioName="What if"
        changes={[]}
        toggleGroups={[]}
        cascadeWarnings={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^group$/i }));
    expect(screen.getByTestId("group-editor")).toBeTruthy();
  });

  it("renders ToggleGroupsSection when toggleGroups prop is non-empty", () => {
    render(
      <ChangesPanel
        clientId="c1"
        scenarioId="s1"
        scenarioName="With groups"
        changes={[]}
        toggleGroups={[
          {
            id: "g-1",
            scenarioId: "s1",
            name: "Roth conversions",
            defaultOn: true,
            requiresGroupId: null,
            orderIndex: 0,
          },
          {
            id: "g-2",
            scenarioId: "s1",
            name: "QCDs",
            defaultOn: false,
            requiresGroupId: null,
            orderIndex: 1,
          },
        ] as ToggleGroup[]}
        cascadeWarnings={[]}
      />,
    );
    expect(screen.getByText(/TOGGLE GROUPS — 2/)).toBeInTheDocument();
    expect(screen.getByTestId("toggle-group-card-g-1")).toBeInTheDocument();
    expect(screen.getByTestId("toggle-group-card-g-2")).toBeInTheDocument();
  });

});
