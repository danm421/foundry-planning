// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import FlowScheduleGrid from "../flow-schedule-grid";

const baseProps = {
  open: true,
  onClose: vi.fn(),
  clientId: "client-1",
  entityId: "ent-1",
  entityName: "Acme LLC",
  entityType: "llc" as const,
  scenarioId: "scenario-1",
  planStartYear: 2026,
  planEndYear: 2028,
  primaryClientBirthYear: 1964, // Age 62 in 2026
  income: { annualAmount: 100_000, growthRate: 0, startYear: 2026, endYear: 2050, inflationStartYear: 2026 },
  expense: { annualAmount: 30_000, growthRate: 0, startYear: 2026, endYear: 2050, inflationStartYear: 2026 },
  initialOverrides: [] as Array<{
    year: number;
    incomeAmount: number | null;
    expenseAmount: number | null;
    distributionPercent: number | null;
  }>,
};

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, count: 0 }),
  }) as unknown as typeof fetch;
});

describe("FlowScheduleGrid", () => {
  it("renders one row per year from planStartYear to planEndYear", () => {
    render(<FlowScheduleGrid {...baseProps} />);
    expect(screen.getByText(/2026/)).toBeInTheDocument();
    expect(screen.getByText(/2027/)).toBeInTheDocument();
    expect(screen.getByText(/2028/)).toBeInTheDocument();
  });

  it("renders Distribution % column for business entities", () => {
    render(<FlowScheduleGrid {...baseProps} />);
    expect(screen.getByText(/distribution/i)).toBeInTheDocument();
  });

  it("hides Distribution % column for trusts", () => {
    render(<FlowScheduleGrid {...baseProps} entityType="trust" />);
    expect(screen.queryByText(/distribution/i)).not.toBeInTheDocument();
  });

  it("Cancel does not call fetch", () => {
    const onClose = vi.fn();
    render(<FlowScheduleGrid {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("Save sends a PUT with the typed values", async () => {
    render(<FlowScheduleGrid {...baseProps} />);
    // Find the income input for 2026 and type a value.
    // CurrencyInput renders type="text" inputs, so use "textbox" role.
    // Row order: income-2026, expense-2026, dist-2026, income-2027, ...
    const inputs = screen.getAllByRole("textbox");
    // First textbox in row 1 = income for 2026.
    fireEvent.change(inputs[0], { target: { value: "250000" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/flow-overrides?scenarioId=scenario-1");
    expect(call[1]?.method).toBe("PUT");
    const body = JSON.parse(call[1]?.body as string);
    const row2026 = body.overrides.find((o: { year: number }) => o.year === 2026);
    expect(row2026.incomeAmount).toBe(250000);
  });

  it("Save in base mode (scenarioId=null) omits the scenarioId query param", async () => {
    render(<FlowScheduleGrid {...baseProps} scenarioId={null} />);
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "175000" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/flow-overrides");
    expect(call[0]).not.toContain("scenarioId=");
    const body = JSON.parse(call[1]?.body as string);
    const row2026 = body.overrides.find((o: { year: number }) => o.year === 2026);
    expect(row2026.incomeAmount).toBe(175000);
  });
});
