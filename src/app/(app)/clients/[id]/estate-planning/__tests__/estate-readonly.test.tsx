// @vitest-environment jsdom
/**
 * TDD read-only gating tests for the estate-planning subtree (Task 18c-2).
 *
 * Under { permission: "view" } every PERSIST / edit affordance must be hidden
 * or rendered inert, while the estate DISPLAY (titles, chip values, tabs) stays
 * visible. Under { permission: "edit" } the affordances are present/interactive.
 *
 * We mount the two cleanly-mountable surfaces:
 *   - ChipBar — clickable assumption chips (inline-save trigger) + "Edit
 *     assumptions" button.
 *   - EstateFlowView — the "Remainder estate" dialog-trigger button (its Save /
 *     Save-as-new buttons only render when the working draft is dirty, which is
 *     code-verified; see report).
 *
 * Heavy children (tab panels, the remainder dialog, the engine projection, the
 * working-copy/gift diff libs, the scenario writer, next/navigation) are mocked
 * — NOT the gating logic.
 */

import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import type { PlanSettings } from "@/engine/types";

// ---------------------------------------------------------------------------
// Mocks — declared before module imports
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/c1/estate-planning",
}));

// EstateFlowView heavy deps — the engine projection + diff libs are mocked so
// the view's own control bar renders deterministically (gating logic stays real).
vi.mock("@/engine/projection", () => ({
  runProjectionWithEvents: () => ({ years: [{ year: 2026 }] }),
}));
vi.mock("@/lib/estate/estate-flow-diff", () => ({ diffWorkingCopy: () => [] }));
vi.mock("@/lib/estate/estate-flow-gift-diff", () => ({ diffGifts: () => [] }));
vi.mock("@/lib/estate/estate-flow-gifts", () => ({
  applyGiftsToClientData: (d: unknown) => d,
}));
vi.mock("@/lib/estate/estate-flow-edits", () => ({ upsertWills: (d: unknown) => d }));
vi.mock("@/lib/estate/estate-flow-base-writes", () => ({ baseWritesForChange: () => [] }));
vi.mock("@/lib/gifts/resolve-annual-exclusion", () => ({
  buildAnnualExclusionMap: () => ({}),
}));
vi.mock("@/hooks/use-scenario-writer", () => ({
  useScenarioWriter: () => ({ submit: vi.fn(), scenarioActive: false }),
}));
vi.mock("@/hooks/use-view-param", () => ({
  useViewParam: (_opts: unknown, initial: string) => useState(initial),
}));

// Estate-flow tab panels + dialogs (leaf children, not under test here).
vi.mock("@/components/estate-flow-report-tab", () => ({
  EstateFlowReportTab: () => <div data-testid="report-tab" />,
}));
vi.mock("@/components/estate-flow-chart-tab", () => ({
  EstateFlowChartTab: () => <div data-testid="chart-tab" />,
}));
vi.mock("@/components/estate-flow-comparison-tab", () => ({
  EstateFlowComparisonTab: () => <div data-testid="comparison-tab" />,
}));
vi.mock("@/components/estate-flow-remainder-dialog", () => ({
  default: () => <div data-testid="remainder-dialog" />,
}));
vi.mock("@/components/report-controls/death-order-toggle", () => ({
  DeathOrderToggle: () => <div data-testid="death-order-toggle" />,
}));

// ChipEditor leaf — keep it observable so we can assert it does NOT mount under view.
vi.mock("../projection/chip-editor", () => ({
  ChipEditor: () => <div data-testid="chip-editor" />,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { ChipBar } from "../projection/chip-bar";
import EstateFlowView, { type EstateFlowViewProps } from "@/components/estate-flow-view";
import { ClientAccessProvider } from "@/components/client-access-provider";
import type { ClientData } from "@/engine/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHIP_SETTINGS: Partial<PlanSettings> = {
  flatStateEstateRate: 0.1,
  planEndYear: 2070,
};

const CLIENT_DATA = {
  planSettings: {
    planStartYear: 2026,
    planEndYear: 2070,
    inflationRate: 0.03,
    taxInflationRate: 0.02,
  },
  taxYearRows: [],
  accounts: [],
  entities: [],
  familyMembers: [],
  externalBeneficiaries: [],
  wills: [],
} as unknown as ClientData;

const EF_PROPS: EstateFlowViewProps = {
  clientId: "c1",
  scenarioId: "base",
  scenarioName: "Base",
  isMarried: false,
  ownerNames: { clientName: "Alice", spouseName: null },
  initialClientData: CLIENT_DATA,
  initialGifts: [],
  cpi: 1,
  doNothingTree: CLIENT_DATA,
  doNothingResult: { years: [] } as never,
  doNothingScenarioName: "Do nothing",
};

// ---------------------------------------------------------------------------
// ChipBar
// ---------------------------------------------------------------------------

describe("ChipBar read-only gating", () => {
  it("renders chips as static (non-clickable) + hides Edit assumptions under view, data still visible", () => {
    render(
      <ClientAccessProvider value={{ permission: "view", access: "shared" }}>
        <ChipBar
          clientId="c1"
          planSettings={CHIP_SETTINGS as PlanSettings}
          onOpenAssumptions={() => {}}
        />
      </ClientAccessProvider>,
    );

    // Chip labels + values still visible (data is readable).
    expect(screen.getByText(/State estate %/)).toBeTruthy();
    expect(screen.getByText(/Plan end year/)).toBeTruthy();
    expect(screen.getByText("2070")).toBeTruthy();

    // The clickable chip <button> must NOT be rendered (chips are static spans).
    const stateChipBtn = screen.queryByRole("button", { name: /State estate %/ });
    expect(stateChipBtn).toBeNull();
    const endYearChipBtn = screen.queryByRole("button", { name: /Plan end year/ });
    expect(endYearChipBtn).toBeNull();

    // "Edit assumptions" button must be hidden.
    const editAssumptions = screen.queryByRole("button", { name: /edit assumptions/i });
    expect(editAssumptions).toBeNull();

    // The inline ChipEditor must never mount under view.
    expect(screen.queryByTestId("chip-editor")).toBeNull();
  });

  it("renders chips as clickable buttons + shows Edit assumptions under edit", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <ChipBar
          clientId="c1"
          planSettings={CHIP_SETTINGS as PlanSettings}
          onOpenAssumptions={() => {}}
        />
      </ClientAccessProvider>,
    );

    const stateChipBtn = screen.queryByRole("button", { name: /State estate %/ });
    expect(stateChipBtn).not.toBeNull();
    const endYearChipBtn = screen.queryByRole("button", { name: /Plan end year/ });
    expect(endYearChipBtn).not.toBeNull();

    const editAssumptions = screen.queryByRole("button", { name: /edit assumptions/i });
    expect(editAssumptions).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// EstateFlowView
// ---------------------------------------------------------------------------

describe("EstateFlowView read-only gating", () => {
  it("hides the Remainder estate dialog-trigger under view, keeps the view + tabs visible", () => {
    render(
      <ClientAccessProvider value={{ permission: "view", access: "shared" }}>
        <EstateFlowView {...EF_PROPS} />
      </ClientAccessProvider>,
    );

    // The estate flow header + a tab panel still render (display intact).
    expect(screen.getByText("Estate Flow")).toBeTruthy();
    expect(screen.getByTestId("report-tab")).toBeTruthy();

    // "Remainder estate" mutation-trigger button must be hidden.
    const remainderBtn = screen.queryByRole("button", { name: /remainder estate/i });
    expect(remainderBtn).toBeNull();
  });

  it("shows the Remainder estate dialog-trigger under edit", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <EstateFlowView {...EF_PROPS} />
      </ClientAccessProvider>,
    );

    expect(screen.getByText("Estate Flow")).toBeTruthy();
    const remainderBtn = screen.queryByRole("button", { name: /remainder estate/i });
    expect(remainderBtn).not.toBeNull();
  });
});
