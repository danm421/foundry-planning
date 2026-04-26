// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ComparePanel } from "../compare-panel";
import type { ToggleGroup } from "@/engine/scenario/types";
import type {
  ScenarioOption,
  SnapshotOption,
} from "../scenario-picker-dropdown";

const setSideMock = vi.fn();
const setToggleMock = vi.fn();
let mockLeft = "base";
let mockRight = "base";
let mockToggleSet = new Set<string>();

vi.mock("@/hooks/use-compare-state", () => ({
  useCompareState: () => ({
    left: mockLeft,
    right: mockRight,
    toggleSet: mockToggleSet,
    setSide: setSideMock,
    setToggle: setToggleMock,
  }),
}));

// SnapshotButton (rendered at panel bottom) calls useRouter from
// next/navigation; mock it to a no-op shape so tests render cleanly.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const SCENARIOS: ScenarioOption[] = [
  { id: "base", name: "Base case", isBaseCase: true },
  { id: "s1", name: "Roth conversion", isBaseCase: false },
  { id: "s2", name: "Early retirement", isBaseCase: false },
];

const SNAPSHOTS: SnapshotOption[] = [
  { id: "snap-m1", name: "Manual A", sourceKind: "manual" },
];

function makeGroup(overrides: Partial<ToggleGroup> = {}): ToggleGroup {
  return {
    id: "g-1",
    scenarioId: "s-1",
    name: "Roth conversions",
    defaultOn: false,
    requiresGroupId: null,
    orderIndex: 0,
    ...overrides,
  };
}

describe("ComparePanel", () => {
  beforeEach(() => {
    setSideMock.mockClear();
    setToggleMock.mockClear();
    mockLeft = "base";
    mockRight = "base";
    mockToggleSet = new Set();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("expanded panel renders header and content area (dropdowns now live in CompareScenarioBar)", () => {
    render(
      <ComparePanel
        clientId="c1"
        scenarios={SCENARIOS}
        snapshots={SNAPSHOTS}
        rightToggleGroups={[]}
        netDelta={null}
        deltaFetcher={() => new Promise<never>(() => {})}
      />,
    );
    expect(screen.getByTestId("compare-panel")).toBeInTheDocument();
    expect(screen.getByText("§.07 · COMPARE")).toBeInTheDocument();
    // Dropdowns are no longer in this panel — moved to CompareScenarioBar.
    expect(screen.queryByText("COMPARING")).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: "Left scenario" }),
    ).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: "Right scenario" }),
    ).toBeNull();
  });

  it("shows EmptyComparePrompt when left === right and hides it when they differ", () => {
    mockLeft = "base";
    mockRight = "base";
    const { rerender } = render(
      <ComparePanel
        clientId="c1"
        scenarios={SCENARIOS}
        snapshots={SNAPSHOTS}
        rightToggleGroups={[makeGroup()]}
        netDelta={{
          value: 100_000,
          metricLabel: "end-of-plan portfolio",
          sparkline: [1, 2, 3],
        }}
        deltaFetcher={() => new Promise<never>(() => {})}
      />,
    );
    expect(screen.getByTestId("compare-empty-prompt")).toBeInTheDocument();
    expect(screen.queryByTestId("net-delta-summary")).toBeNull();
    expect(screen.queryByTestId("toggle-list")).toBeNull();

    mockLeft = "base";
    mockRight = "s1";
    rerender(
      <ComparePanel
        clientId="c1"
        scenarios={SCENARIOS}
        snapshots={SNAPSHOTS}
        rightToggleGroups={[makeGroup()]}
        netDelta={{
          value: 100_000,
          metricLabel: "end-of-plan portfolio",
          sparkline: [1, 2, 3],
        }}
        deltaFetcher={() => new Promise<never>(() => {})}
      />,
    );
    expect(screen.queryByTestId("compare-empty-prompt")).toBeNull();
  });

  it("renders NetDeltaSummary only when netDelta is non-null and left !== right", () => {
    mockLeft = "base";
    mockRight = "s1";
    const { rerender } = render(
      <ComparePanel
        clientId="c1"
        scenarios={SCENARIOS}
        snapshots={SNAPSHOTS}
        rightToggleGroups={[]}
        netDelta={{
          value: 250_000,
          metricLabel: "end-of-plan portfolio",
          sparkline: [10, 20, 30],
        }}
        deltaFetcher={() => new Promise<never>(() => {})}
      />,
    );
    expect(screen.getByTestId("net-delta-summary")).toBeInTheDocument();

    // Same side — summary suppressed even though netDelta non-null
    mockLeft = "base";
    mockRight = "base";
    rerender(
      <ComparePanel
        clientId="c1"
        scenarios={SCENARIOS}
        snapshots={SNAPSHOTS}
        rightToggleGroups={[]}
        netDelta={{
          value: 250_000,
          metricLabel: "end-of-plan portfolio",
          sparkline: [10, 20, 30],
        }}
        deltaFetcher={() => new Promise<never>(() => {})}
      />,
    );
    expect(screen.queryByTestId("net-delta-summary")).toBeNull();

    // Different sides but netDelta=null — also suppressed
    mockLeft = "base";
    mockRight = "s1";
    rerender(
      <ComparePanel
        clientId="c1"
        scenarios={SCENARIOS}
        snapshots={SNAPSHOTS}
        rightToggleGroups={[]}
        netDelta={null}
        deltaFetcher={() => new Promise<never>(() => {})}
      />,
    );
    expect(screen.queryByTestId("net-delta-summary")).toBeNull();
  });

  it("renders ToggleList only when rightToggleGroups.length > 0 and left !== right", () => {
    mockLeft = "base";
    mockRight = "s1";
    const { rerender } = render(
      <ComparePanel
        clientId="c1"
        scenarios={SCENARIOS}
        snapshots={SNAPSHOTS}
        rightToggleGroups={[makeGroup({ id: "g-1", name: "Roth" })]}
        netDelta={null}
        deltaFetcher={() => new Promise<never>(() => {})}
      />,
    );
    expect(screen.getByTestId("toggle-list")).toBeInTheDocument();

    // Empty groups — toggle list suppressed
    rerender(
      <ComparePanel
        clientId="c1"
        scenarios={SCENARIOS}
        snapshots={SNAPSHOTS}
        rightToggleGroups={[]}
        netDelta={null}
        deltaFetcher={() => new Promise<never>(() => {})}
      />,
    );
    expect(screen.queryByTestId("toggle-list")).toBeNull();

    // Same sides — toggle list suppressed even with groups present
    mockLeft = "base";
    mockRight = "base";
    rerender(
      <ComparePanel
        clientId="c1"
        scenarios={SCENARIOS}
        snapshots={SNAPSHOTS}
        rightToggleGroups={[makeGroup({ id: "g-1", name: "Roth" })]}
        netDelta={null}
        deltaFetcher={() => new Promise<never>(() => {})}
      />,
    );
    expect(screen.queryByTestId("toggle-list")).toBeNull();
  });

  it("when right is a snapshot, ToggleList is non-interactive and the snapshot button is disabled", () => {
    mockLeft = "base";
    mockRight = "snap:snap-m1";
    render(
      <ComparePanel
        clientId="c1"
        scenarios={SCENARIOS}
        snapshots={SNAPSHOTS}
        rightToggleGroups={[makeGroup({ id: "g-1", name: "Roth" })]}
        netDelta={null}
        deltaFetcher={() => new Promise<never>(() => {})}
      />,
    );
    // ToggleList renders, but the toggle row is muted + the switch is disabled.
    expect(screen.getByTestId("toggle-list")).toBeInTheDocument();
    const row = screen.getByTestId("toggle-row-g-1");
    expect(row.className).toContain("opacity-60");
    const toggleBtn = screen.getByRole("button", { name: /Toggle on/ });
    expect(toggleBtn).toBeDisabled();

    // SnapshotButton at the bottom is gated because right is already frozen.
    const snapBtn = screen.getByTestId("snapshot-button") as HTMLButtonElement;
    expect(snapBtn).toBeDisabled();
  });

  it("when right is a live scenario, ToggleList stays interactive", () => {
    mockLeft = "base";
    mockRight = "s1";
    render(
      <ComparePanel
        clientId="c1"
        scenarios={SCENARIOS}
        snapshots={SNAPSHOTS}
        rightToggleGroups={[makeGroup({ id: "g-1", name: "Roth" })]}
        netDelta={null}
        deltaFetcher={() => new Promise<never>(() => {})}
      />,
    );
    const row = screen.getByTestId("toggle-row-g-1");
    expect(row.className).not.toContain("opacity-60");
    const toggleBtn = screen.getByRole("button", { name: /Toggle on/ });
    expect(toggleBtn).not.toBeDisabled();
  });

  it("collapse chevron toggles the panel into a 48px sliver and back", () => {
    mockLeft = "s1";
    mockRight = "snap:snap-m1";
    render(
      <ComparePanel
        clientId="c1"
        scenarios={SCENARIOS}
        snapshots={SNAPSHOTS}
        rightToggleGroups={[]}
        netDelta={null}
        deltaFetcher={() => new Promise<never>(() => {})}
      />,
    );
    // Expanded by default
    const expanded = screen.getByTestId("compare-panel");
    expect(expanded.className).toContain("w-[360px]");

    // Click "›" to collapse
    fireEvent.click(
      screen.getByRole("button", { name: "Collapse compare panel" }),
    );
    expect(screen.queryByTestId("compare-panel")).toBeNull();
    const collapsed = screen.getByTestId("compare-panel-collapsed");
    expect(collapsed.className).toContain("w-12");

    // Vertical label includes the truncated, uppercased labels for both sides
    const vertical = screen.getByTestId("compare-panel-vertical-label");
    expect(vertical).toHaveTextContent("ROTH CONVERSI…");
    expect(vertical).toHaveTextContent("MANUAL A");
    expect(vertical).toHaveTextContent("vs");

    // Click "‹" to expand again
    fireEvent.click(
      screen.getByRole("button", { name: "Expand compare panel" }),
    );
    expect(screen.queryByTestId("compare-panel-collapsed")).toBeNull();
    expect(screen.getByTestId("compare-panel")).toBeInTheDocument();
  });
});
