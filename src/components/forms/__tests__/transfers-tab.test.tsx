// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import TransfersTab, {
  type TransferEvent,
  type TransferSeries,
  type ExemptionDisplay,
} from "../transfers-tab";

// ── Mock factories ────────────────────────────────────────────────────────────

function mockExemption(overrides?: Partial<ExemptionDisplay>): ExemptionDisplay {
  return {
    client: { used: 0, total: 13_600_000 },
    spouse: { used: 0, total: 13_600_000 },
    ...overrides,
  };
}

function mockCashGift(overrides?: Partial<Extract<TransferEvent, { kind: "cash" }>>): TransferEvent {
  return {
    kind: "cash",
    id: "cash-1",
    year: 2026,
    amount: 19_000,
    grantor: "client",
    useCrummeyPowers: false,
    ...overrides,
  };
}

interface AssetTransferOverrides {
  id?: string;
  year?: number;
  account?: string;
  percent?: number;
  value?: number;
  grantor?: "client" | "spouse";
  bundledLiability?: { name: string; value: number };
  notes?: string;
}

function mockAssetTransfer(overrides?: AssetTransferOverrides): TransferEvent {
  const pct = overrides?.percent ?? 0.5;
  return {
    kind: "asset",
    id: overrides?.id ?? "asset-1",
    year: overrides?.year ?? 2030,
    accountName: overrides?.account ?? "Vanguard",
    percent: pct,
    value: overrides?.value ?? 1_200_000,
    grantor: overrides?.grantor ?? "client",
    bundledLiability: overrides?.bundledLiability
      ? {
          name: overrides.bundledLiability.name,
          value: overrides.bundledLiability.value,
          percent: pct,
        }
      : undefined,
  };
}

function mockSeries(overrides?: Partial<TransferSeries>): TransferSeries {
  return {
    id: "series-1",
    startYear: 2026,
    endYear: 2042,
    annualAmount: 19_000,
    inflationAdjust: false,
    useCrummeyPowers: false,
    grantor: "client",
    ...overrides,
  };
}

function handlers() {
  return {
    onAdd: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    totalConsumedByThisTrust: { client: 0, spouse: 0 },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TransfersTab", () => {
  it("renders the empty state when no events", () => {
    render(
      <TransfersTab
        events={[]}
        series={[]}
        exemption={mockExemption()}
        {...handlers()}
      />
    );
    expect(screen.getByText(/No transfers recorded yet/i)).toBeInTheDocument();
  });

  it("renders cash gift rows", () => {
    render(
      <TransfersTab
        events={[mockCashGift({ year: 2026, amount: 19_000 })]}
        series={[]}
        exemption={mockExemption()}
        {...handlers()}
      />
    );
    expect(screen.getByText(/19,000/)).toBeInTheDocument();
  });

  it("renders asset transfer with bundled liability sub-row", () => {
    render(
      <TransfersTab
        events={[
          mockAssetTransfer({
            year: 2030,
            account: "Vanguard",
            percent: 0.5,
            value: 1_200_000,
            bundledLiability: { name: "Mortgage", value: 120_000 },
          }),
        ]}
        series={[]}
        exemption={mockExemption()}
        {...handlers()}
      />
    );
    // Both the main row ("Vanguard 50%") and the sub-row ("Mortgage on Vanguard...50%") match;
    // use getAllByText and assert at least one hit so getBy doesn't complain about multiples.
    expect(screen.getAllByText(/Vanguard.*50%/i).length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText(/Mortgage on Vanguard \(auto-bundled, 50%\)/i)
    ).toBeInTheDocument();
  });

  it("renders collapsed series row with crummey indicator", () => {
    render(
      <TransfersTab
        events={[]}
        series={[
          mockSeries({
            startYear: 2026,
            endYear: 2042,
            annualAmount: 19_000,
            inflationAdjust: true,
            useCrummeyPowers: true,
          }),
        ]}
        exemption={mockExemption()}
        {...handlers()}
      />
    );
    expect(screen.getByText(/2026.{1,3}2042/)).toBeInTheDocument();
    expect(screen.getByText(/19,000\/yr/)).toBeInTheDocument();
    expect(screen.getByText(/Crummey powers ✓/i)).toBeInTheDocument();
  });

  it("renders lifetime exemption usage bar", () => {
    render(
      <TransfersTab
        events={[]}
        series={[]}
        exemption={mockExemption({ client: { used: 4_200_000, total: 13_600_000 } })}
        {...handlers()}
      />
    );
    expect(screen.getByText(/used \$4\.2M.{0,5}\$13\.6M/)).toBeInTheDocument();
  });

  it("Add transfer menu fires onAdd with the correct kind", () => {
    const h = handlers();
    render(
      <TransfersTab events={[]} series={[]} exemption={mockExemption()} {...h} />
    );
    fireEvent.click(screen.getByRole("button", { name: /add transfer/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /cash gift/i }));
    expect(h.onAdd).toHaveBeenCalledWith("cash");
  });
});
