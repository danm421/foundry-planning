// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SolverChangesTab } from "../solver-changes-tab";
import type { PanelData } from "@/lib/scenario/load-panel-data";
import type { ChangesPanelChange } from "@/components/scenario/changes-panel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
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

function makePanel(overrides: Partial<PanelData> = {}): PanelData {
  return {
    scenarioId: "s-1",
    scenarioName: "Retire at 62",
    changes: [makeChange()],
    toggleGroups: [],
    cascadeWarnings: [],
    targetNames: {},
    ...overrides,
  };
}

describe("SolverChangesTab", () => {
  it("renders the embedded ChangesPanel for a scenario", () => {
    render(<SolverChangesTab clientId="c1" panel={makePanel()} />);
    expect(screen.getByText("Retire at 62")).toBeInTheDocument();
    expect(screen.getByTestId("leaf-row-c-1")).toBeInTheDocument();
    // embedded variant drops the rail's fixed width
    const aside = document.querySelector("aside");
    expect(aside?.className).toContain("w-full");
    expect(aside?.className).not.toContain("w-[360px]");
  });

  it("shows a quiet empty state on the base case (panel === null)", () => {
    render(<SolverChangesTab clientId="c1" panel={null} />);
    expect(screen.getByText("Pick a scenario to see its changes.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^group$/i })).not.toBeInTheDocument();
  });
});
