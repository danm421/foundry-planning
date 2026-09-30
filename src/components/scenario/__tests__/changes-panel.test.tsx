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
    enabled: true,
    label: null,
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

  describe("variant", () => {
    it("defaults to 'rail' and leaves the existing markup untouched", () => {
      const { container } = render(
        <ChangesPanel
          clientId="c1"
          scenarioId="s1"
          scenarioName="Rail"
          changes={[]}
          toggleGroups={[]}
          cascadeWarnings={[]}
        />,
      );
      expect(container.querySelector("aside")?.className).toBe(
        "w-[360px] shrink-0 border-l border-hair bg-card flex flex-col ",
      );
    });

    it("'embedded' drops the rail's fixed width/border for w-full", () => {
      const { container } = render(
        <ChangesPanel
          clientId="c1"
          scenarioId="s1"
          scenarioName="Embedded"
          changes={[]}
          toggleGroups={[]}
          cascadeWarnings={[]}
          variant="embedded"
        />,
      );
      const aside = container.querySelector("aside");
      expect(aside?.className).toContain("w-full");
      expect(aside?.className).not.toContain("w-[360px]");
      expect(aside?.className).not.toContain("shrink-0");
      expect(aside?.className).not.toContain("border-l");
    });
  });

  describe("openable rows", () => {
    it("no onOpenChange means rows stay non-openable", () => {
      render(
        <ChangesPanel
          clientId="c1"
          scenarioId="s1"
          scenarioName="Default"
          changes={[makeChange({ payload: { name: "Static" } })]}
          toggleGroups={[]}
          cascadeWarnings={[]}
        />,
      );
      expect(screen.queryByRole("button", { name: "Edit Static" })).not.toBeInTheDocument();
    });

    it("absent canOpenChange makes every row openable when onOpenChange is provided", () => {
      const onOpenChange = vi.fn();
      render(
        <ChangesPanel
          clientId="c1"
          scenarioId="s1"
          scenarioName="Any"
          changes={[makeChange({ payload: { name: "Any change" } })]}
          toggleGroups={[]}
          cascadeWarnings={[]}
          onOpenChange={onOpenChange}
        />,
      );
      const button = screen.getByRole("button", { name: "Edit Any change" });
      fireEvent.click(button);
      expect(onOpenChange).toHaveBeenCalledTimes(1);
    });

    it("gates openability per-row via canOpenChange and fires onOpenChange with the change", () => {
      const onOpenChange = vi.fn();
      const openable = makeChange({ id: "c-open", payload: { name: "Openable" } });
      const blocked = makeChange({ id: "c-blocked", payload: { name: "Blocked" } });
      render(
        <ChangesPanel
          clientId="c1"
          scenarioId="s1"
          scenarioName="Openable"
          changes={[openable, blocked]}
          toggleGroups={[]}
          cascadeWarnings={[]}
          onOpenChange={onOpenChange}
          canOpenChange={(c) => c.id === "c-open"}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Edit Openable" }));
      expect(onOpenChange).toHaveBeenCalledWith(openable);
      expect(screen.queryByRole("button", { name: "Edit Blocked" })).not.toBeInTheDocument();
    });

    it("names each row's button with openVerbFor, in both sections", () => {
      const ungrouped = makeChange({ id: "c-ungrouped", payload: { name: "Stress lever" } });
      const grouped = makeChange({ id: "c-grouped", toggleGroupId: "g-1", payload: { name: "Grouped change" } });
      render(
        <ChangesPanel
          clientId="c1"
          scenarioId="s1"
          scenarioName="Verbs"
          changes={[ungrouped, grouped]}
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
          onOpenChange={vi.fn()}
          openVerbFor={() => "Open"}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /^Roth conversions/ }));
      expect(screen.getByRole("button", { name: "Open Stress lever" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Open Grouped change" })).toBeInTheDocument();
    });

    it("forwards onOpenChange/canOpenChange to toggle-group-card leaf rows", () => {
      const onOpenChange = vi.fn();
      const grouped = makeChange({
        id: "c-grouped",
        toggleGroupId: "g-1",
        payload: { name: "Grouped change" },
      });
      render(
        <ChangesPanel
          clientId="c1"
          scenarioId="s1"
          scenarioName="Grouped"
          changes={[grouped]}
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
          onOpenChange={onOpenChange}
        />,
      );
      // Expand the group card to reveal its leaf row.
      fireEvent.click(screen.getByRole("button", { name: /^Roth conversions/ }));
      const button = screen.getByRole("button", { name: "Edit Grouped change" });
      fireEvent.click(button);
      expect(onOpenChange).toHaveBeenCalledWith(grouped);
    });
  });

});
