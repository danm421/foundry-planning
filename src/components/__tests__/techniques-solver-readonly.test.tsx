// @vitest-environment jsdom
/**
 * TDD tests for read-only gating in SolverActionBar (primary, trivially mountable)
 * and TechniquesView (attempted with mocks).
 *
 * SolverActionBar is pure presentational (no hooks/context) — the primary test.
 * TechniquesView requires next/navigation + useScenarioWriter + useScenarioState
 * + fetch + several dialog components. We attempt mounting with leaf mocks.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks — declared before any module imports
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/test-client/techniques",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock("@/hooks/use-scenario-writer", () => ({
  useScenarioWriter: () => ({ submit: vi.fn() }),
}));

vi.mock("@/hooks/use-scenario-state", () => ({
  useScenarioState: () => ({ scenarioId: null }),
}));

// Mock heavy dialog components
vi.mock("@/components/forms/add-transfer-form", () => ({ default: () => null }));
vi.mock("@/components/forms/add-reinvestment-form", () => ({ default: () => null }));
vi.mock("@/components/forms/add-relocation-form", () => ({ default: () => null }));
vi.mock("@/components/forms/add-asset-transaction-form", () => ({ default: () => null }));
vi.mock("@/components/forms/add-roth-conversion-form", () => ({ default: () => null }));
vi.mock("@/components/help-tip", () => ({ HelpTip: () => null }));

// Mock engine + lib deps pulled in by TechniquesView
vi.mock("@/engine", () => ({
  runProjection: () => [],
}));
vi.mock("@/lib/solver/technique-summaries", () => ({
  formatReinvestmentScope: (g: number, a: number) => `${g}g ${a}a`,
}));
vi.mock("@/lib/milestones", () => ({
  YEAR_REF_LABELS: {},
}));

// Silence fetch so the projection useEffect doesn't error
global.fetch = vi.fn(() => Promise.resolve({ ok: false } as Response));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { SolverActionBar } from "@/app/(app)/clients/[id]/solver/solver-action-bar";
import { ClientAccessProvider } from "@/components/client-access-provider";
import TechniquesView from "@/components/techniques-view";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MINIMAL_PROPS = {
  clientId: "c-1",
  transfers: [],
  reinvestments: [],
  relocations: [],
  assetTransactions: [],
  rothConversions: [
    {
      id: "rc-1",
      name: "Roth Conv 1",
      destinationAccountId: "acc-roth",
      sourceAccountIds: ["acc-trad"],
      conversionType: "fixed_amount" as const,
      fixedAmount: "10000",
      fillUpBracket: null,
      startYear: 2025,
      startYearRef: null,
      endYear: 2030,
      endYearRef: null,
      indexingRate: "0",
      inflationStartYear: null,
    },
  ],
  accounts: [
    { id: "acc-roth", name: "Roth IRA", category: "retirement", subType: "roth_ira" },
    { id: "acc-trad", name: "Traditional IRA", category: "retirement", subType: "traditional_ira" },
  ],
  liabilities: [],
  businesses: [],
  modelPortfolios: [],
};

// ---------------------------------------------------------------------------
// SolverActionBar — primary test (pure presentational, no context required)
// ---------------------------------------------------------------------------

describe("SolverActionBar — canEdit prop", () => {
  it("RED→GREEN: canEdit=false hides Save to base facts and Save as scenario, keeps Reset", () => {
    render(
      <SolverActionBar
        hasMutations={true}
        canSaveToBase={true}
        canEdit={false}
        onReset={vi.fn()}
        onSave={vi.fn()}
        onSaveToBase={vi.fn()}
      />,
    );

    expect(screen.queryByText("Save to base facts")).toBeNull();
    expect(screen.queryByText("Save as scenario…")).toBeNull();
    expect(screen.getByText("Reset")).toBeTruthy();
  });

  it("canEdit=true (default) shows all three buttons", () => {
    render(
      <SolverActionBar
        hasMutations={true}
        canSaveToBase={true}
        onReset={vi.fn()}
        onSave={vi.fn()}
        onSaveToBase={vi.fn()}
      />,
    );

    expect(screen.getByText("Save to base facts")).toBeTruthy();
    expect(screen.getByText("Save as scenario…")).toBeTruthy();
    expect(screen.getByText("Reset")).toBeTruthy();
  });

  it("canEdit=false with hasMutations=false still shows Reset (disabled)", () => {
    render(
      <SolverActionBar
        hasMutations={false}
        canSaveToBase={false}
        canEdit={false}
        onReset={vi.fn()}
        onSave={vi.fn()}
        onSaveToBase={vi.fn()}
      />,
    );

    expect(screen.getByText("Reset")).toBeTruthy();
    expect(screen.queryByText("Save to base facts")).toBeNull();
    expect(screen.queryByText("Save as scenario…")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TechniquesView — gating via ClientAccessProvider
// ---------------------------------------------------------------------------

describe("TechniquesView — read-only gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(() => Promise.resolve({ ok: false } as Response));
  });

  it("view permission: hides +Add buttons", () => {
    render(
      <ClientAccessProvider value={{ permission: "view", access: "shared" }}>
        <TechniquesView {...MINIMAL_PROPS} />
      </ClientAccessProvider>,
    );

    expect(screen.queryByText("+ Add Roth Conversion")).toBeNull();
    expect(screen.queryByText("+ Add Transfer")).toBeNull();
    expect(screen.queryByText("+ Add Reinvestment")).toBeNull();
    expect(screen.queryByText("+ Add Transaction")).toBeNull();
  });

  it("view permission: row data still visible (Roth Conv 1 name shows)", () => {
    render(
      <ClientAccessProvider value={{ permission: "view", access: "shared" }}>
        <TechniquesView {...MINIMAL_PROPS} />
      </ClientAccessProvider>,
    );

    expect(screen.getByText("Roth Conv 1")).toBeTruthy();
  });

  it("view permission: no Edit or Delete buttons", () => {
    render(
      <ClientAccessProvider value={{ permission: "view", access: "shared" }}>
        <TechniquesView {...MINIMAL_PROPS} />
      </ClientAccessProvider>,
    );

    expect(screen.queryByText("Edit")).toBeNull();
    // Delete uses aria-label, not text
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("edit permission: shows +Add buttons", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <TechniquesView {...MINIMAL_PROPS} />
      </ClientAccessProvider>,
    );

    expect(screen.getByText("+ Add Roth Conversion")).toBeTruthy();
    expect(screen.getByText("+ Add Transfer")).toBeTruthy();
    expect(screen.getByText("+ Add Reinvestment")).toBeTruthy();
    expect(screen.getByText("+ Add Transaction")).toBeTruthy();
  });

  it("edit permission: shows Edit button for Roth Conv row", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <TechniquesView {...MINIMAL_PROPS} />
      </ClientAccessProvider>,
    );

    expect(screen.getByText("Edit")).toBeTruthy();
  });
});
