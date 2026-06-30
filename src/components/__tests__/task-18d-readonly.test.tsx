// @vitest-environment jsdom
/**
 * Task 18d — Read-only gate tests.
 *
 * Covers the cleanly-mountable surfaces:
 *   1. BalanceSheetPdfButton — trivial component, no heavy deps
 *   2. OpenItemsList — open/done items CRUD
 *   3. MonteCarloReport — "Generate New Seed" button (heavy; mocks all chart sub-components)
 *   4. ExportButton — export affordance (mocks ExportModal)
 *   5. MedicareInflationControls — checkbox + rate input read-only-izing
 *
 * For each surface: permission="view" → trigger ABSENT, data VISIBLE
 *                   permission="edit" → trigger PRESENT
 *
 * Components that could NOT be mounted even with mocks:
 *   - onboarding-shell / review-step / launcher — reading-verified (see task-18d-report.md)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ClientAccessProvider } from "@/components/client-access-provider";

// ---------------------------------------------------------------------------
// Mocks (declared before component imports)
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/test-client",
  useParams: () => ({ id: "test-client" }),
}));

// Mock heavy chart sub-components so MonteCarloReport can mount in jsdom
vi.mock("@/components/monte-carlo/fan-chart", () => ({
  FanChart: () => <div data-testid="fan-chart" />,
}));
vi.mock("@/components/monte-carlo/terminal-histogram", () => ({
  TerminalHistogram: () => <div data-testid="terminal-histogram" />,
}));
vi.mock("@/components/monte-carlo/longevity-chart", () => ({
  LongevityChart: () => <div data-testid="longevity-chart" />,
}));
vi.mock("@/components/monte-carlo/report-header", () => ({
  ReportHeader: () => <div data-testid="report-header" />,
}));
vi.mock("@/components/monte-carlo/kpi-band", () => ({
  KpiBand: () => <div data-testid="kpi-band" />,
}));
vi.mock("@/components/monte-carlo/findings-card", () => ({
  FindingsCard: () => <div data-testid="findings-card" />,
}));
vi.mock("@/components/monte-carlo/yearly-breakdown", () => ({
  YearlyBreakdown: () => <div data-testid="yearly-breakdown" />,
}));
vi.mock("@/app/(app)/clients/[id]/cashflow/monte-carlo/loading-skeleton", () => ({
  default: () => <div data-testid="mc-skeleton" />,
}));
vi.mock("@/lib/chart-colors", () => ({
  useThemeName: () => "dark",
}));
vi.mock("@/brand", () => ({
  colors: { cat: { income: "#fff", life: "#000" } },
  colorsLight: { cat: { income: "#fff", life: "#000" } },
}));

// Mock ExportModal so ExportButton can mount
vi.mock("@/components/exports/export-modal", () => ({
  ExportModal: ({ open, reportId }: { open: boolean; reportId: string; onOpenChange: () => void }) =>
    open ? <div role="dialog" aria-label={`export-${reportId}`} /> : null,
}));

// Mock OpenItemDialog
vi.mock("@/components/open-items/open-item-dialog", () => ({
  default: ({ open }: { open: boolean; onOpenChange: () => void; onSubmit: () => void }) =>
    open ? <div role="dialog" aria-label="open-item-dialog" /> : null,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import BalanceSheetPdfButton from "@/components/balance-sheet-pdf-button";
import OpenItemsList from "@/components/open-items/open-items-list";
import MonteCarloReport from "@/components/monte-carlo-report";
import { ExportButton } from "@/components/exports/export-button";
import { MedicareInflationControls } from "@/components/cashflow/medicare/medicare-inflation-controls";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLIENT_ID = "test-client-id";

const OPEN_ITEMS = [
  {
    id: "item-1",
    title: "Review portfolio allocation",
    priority: "high" as const,
    dueDate: null,
    completedAt: null,
  },
];

const DONE_ITEMS = [
  {
    id: "item-2",
    title: "Completed task",
    priority: "low" as const,
    dueDate: null,
    completedAt: "2024-01-01T00:00:00Z",
  },
];

// Minimal MonteCarloSummary fixture (enough to make the component show data + seed button)
const MC_SUMMARY = {
  trialsRun: 1000,
  successRate: 0.85,
  successCount: 850,
  medianTerminalValue: 500000,
  p10TerminalValue: 100000,
  p90TerminalValue: 1200000,
  byYear: [{ age: { client: 65 }, p10: 400000, p50: 500000, p90: 600000, deterministic: 520000 }],
};

const MC_RESULT = {
  byYear: MC_SUMMARY.byYear,
  trialsRun: 1000,
  byYearLiquidAssetsPerTrial: [[500000, 520000]], // 1 trial × 2 years for fixture purposes
};

const MC_FETCH_RESPONSE = {
  payload: { summary: MC_SUMMARY, deterministic: [] },
  raw: MC_RESULT,
  meta: { retirementAge: 65, spouseRetirementAge: null },
};

// ---------------------------------------------------------------------------
// BalanceSheetPdfButton tests
// ---------------------------------------------------------------------------

describe("BalanceSheetPdfButton read-only gating", () => {
  it("hides Download PDF button under permission='view'", () => {
    render(
      <ClientAccessProvider value={{ permission: "view", access: "shared" }}>
        <BalanceSheetPdfButton clientId={CLIENT_ID} />
      </ClientAccessProvider>,
    );
    const btn = screen.queryByRole("button", { name: /download pdf/i });
    expect(btn).toBeNull();
  });

  it("shows Download PDF button under permission='edit'", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <BalanceSheetPdfButton clientId={CLIENT_ID} />
      </ClientAccessProvider>,
    );
    const btn = screen.queryByRole("button", { name: /download pdf/i });
    expect(btn).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// OpenItemsList tests
// ---------------------------------------------------------------------------

describe("OpenItemsList read-only gating", () => {
  it("hides Add item, Edit, and Delete buttons under permission='view'", () => {
    render(
      <ClientAccessProvider value={{ permission: "view", access: "shared" }}>
        <OpenItemsList clientId={CLIENT_ID} items={[...OPEN_ITEMS, ...DONE_ITEMS]} />
      </ClientAccessProvider>,
    );

    // Data (item title) stays visible
    expect(screen.getByText("Review portfolio allocation")).toBeTruthy();
    expect(screen.getByText("Completed task")).toBeTruthy();

    // Mutation affordances hidden
    expect(screen.queryByRole("button", { name: /add item/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull();
  });

  it("shows Add item, Edit, and Delete buttons under permission='edit'", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <OpenItemsList clientId={CLIENT_ID} items={[...OPEN_ITEMS, ...DONE_ITEMS]} />
      </ClientAccessProvider>,
    );

    // Data still visible
    expect(screen.getByText("Review portfolio allocation")).toBeTruthy();

    // Mutation affordances present
    expect(screen.queryByRole("button", { name: /add item/i })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeNull();
    // Must expand the "Completed" details before Delete appears
    const details = screen.getByText(/completed \(1\)/i);
    details.click(); // click the <summary> to expand
    expect(screen.queryByRole("button", { name: /^delete$/i })).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// MonteCarloReport — Generate New Seed button
// ---------------------------------------------------------------------------

describe("MonteCarloReport 'Generate New Seed' gating", () => {
  beforeEach(() => {
    // Supply a successful fetch response so `summary` state gets populated
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MC_FETCH_RESPONSE,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hides 'Generate New Seed' button under permission='view' (summary visible)", async () => {
    await act(async () => {
      render(
        <ClientAccessProvider value={{ permission: "view", access: "shared" }}>
          <MonteCarloReport clientId={CLIENT_ID} />
        </ClientAccessProvider>,
      );
    });

    // Seed button must not be present
    expect(screen.queryByRole("button", { name: /generate new seed/i })).toBeNull();

    // Data sub-components are still rendered (mocked → testids present)
    expect(screen.queryByTestId("yearly-breakdown")).not.toBeNull();
  });

  it("shows 'Generate New Seed' button under permission='edit'", async () => {
    await act(async () => {
      render(
        <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
          <MonteCarloReport clientId={CLIENT_ID} />
        </ClientAccessProvider>,
      );
    });

    expect(screen.queryByRole("button", { name: /generate new seed/i })).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ExportButton read-only gating
// ---------------------------------------------------------------------------

describe("ExportButton read-only gating", () => {
  it("renders null (no Export button) under permission='view'", () => {
    render(
      <ClientAccessProvider value={{ permission: "view", access: "shared" }}>
        <ExportButton reportId="cash-flow" />
      </ClientAccessProvider>,
    );
    expect(screen.queryByRole("button", { name: /export/i })).toBeNull();
  });

  it("renders Export button under permission='edit'", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <ExportButton reportId="cash-flow" />
      </ClientAccessProvider>,
    );
    expect(screen.queryByRole("button", { name: /export/i })).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// MedicareInflationControls — disabled under view
// ---------------------------------------------------------------------------

describe("MedicareInflationControls read-only gating", () => {
  const noop = vi.fn();

  it("disables checkbox and rate input under permission='view'", () => {
    render(
      <ClientAccessProvider value={{ permission: "view", access: "shared" }}>
        <MedicareInflationControls rate={0.03} enabled={true} onChange={noop} saveError={null} />
      </ClientAccessProvider>,
    );

    // Values still visible
    expect(screen.getByRole("checkbox")).toBeTruthy();
    expect(screen.getByRole("spinbutton")).toBeTruthy(); // type=number

    // Inputs are disabled (mutation blocked)
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("spinbutton")).toBeDisabled();
  });

  it("leaves checkbox and rate input enabled under permission='edit'", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <MedicareInflationControls rate={0.03} enabled={true} onChange={noop} saveError={null} />
      </ClientAccessProvider>,
    );

    expect(screen.getByRole("checkbox")).not.toBeDisabled();
    // Rate input is enabled because !enabled=false and canEdit=true
    expect(screen.getByRole("spinbutton")).not.toBeDisabled();
  });
});
