// @vitest-environment jsdom
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import FlowScheduleGrid, { type ScheduleSaveBinding } from "../flow-schedule-grid";

/**
 * Renders the grid and exposes a `save()` helper. The grid no longer owns its
 * Save button — the dialog footer does — so tests drive saves through the
 * binding the grid registers with its parent.
 */
function renderWithSave(overrideProps: Partial<typeof baseProps> = {}) {
  const ref: { current: ScheduleSaveBinding | null } = { current: null };
  render(
    <FlowScheduleGrid
      {...baseProps}
      {...overrideProps}
      onSaveBindingChange={(b) => {
        ref.current = b;
      }}
    />,
  );
  return {
    async save() {
      if (!ref.current) throw new Error("save binding was never registered");
      await act(async () => {
        await ref.current!.save();
      });
    },
  };
}

const baseProps = {
  clientId: "client-1",
  entityId: "ent-1",
  entityType: "llc" as const,
  scenarioId: "scenario-1" as string | null,
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
    // Column header — anchored by the 0%/100% quick-set buttons in the same cell.
    expect(screen.getByRole("button", { name: "0%" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "100%" })).toBeInTheDocument();
  });

  it("hides Distribution % column for trusts", () => {
    render(<FlowScheduleGrid {...baseProps} entityType="trust" />);
    expect(screen.queryByText(/distribution/i)).not.toBeInTheDocument();
  });

  // Quick-fill panel adds 4 textbox-role inputs (income, expense, dist %, growth)
  // ahead of the per-year grid for business entities. Per-year grid order is
  // income, expense, dist for each row.
  const QUICK_FILL_TEXTBOXES_BUSINESS = 4;
  const incomeInputForYearIndex = (yearOffset: number, distColumn = true) =>
    QUICK_FILL_TEXTBOXES_BUSINESS + yearOffset * (distColumn ? 3 : 2);

  it("Save sends a PUT with the typed values", async () => {
    const { save } = renderWithSave();
    const inputs = screen.getAllByRole("textbox");
    // Year 2026 income (first per-year row, first column after the quick-fill panel).
    fireEvent.change(inputs[incomeInputForYearIndex(0)], { target: { value: "250000" } });
    await save();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/flow-overrides?scenarioId=scenario-1");
    expect(call[1]?.method).toBe("PUT");
    const body = JSON.parse(call[1]?.body as string);
    const row2026 = body.overrides.find((o: { year: number }) => o.year === 2026);
    expect(row2026.incomeAmount).toBe(250000);
  });

  it("Save in base mode (scenarioId=null) omits the scenarioId query param", async () => {
    const { save } = renderWithSave({ scenarioId: null });
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[incomeInputForYearIndex(0)], { target: { value: "175000" } });
    await save();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/flow-overrides");
    expect(call[0]).not.toContain("scenarioId=");
    const body = JSON.parse(call[1]?.body as string);
    const row2026 = body.overrides.find((o: { year: number }) => o.year === 2026);
    expect(row2026.incomeAmount).toBe(175000);
  });

  it("Quick-fill applies income with growth across the year range", async () => {
    const { save } = renderWithSave();
    // Quick-fill panel order: Start year (number), End year (number),
    // Income, Expense, Distribution %, Growth %.
    const numbers = screen.getAllByRole("spinbutton"); // type=number inputs
    const startYearInput = numbers[0];
    const endYearInput = numbers[1];
    // First 4 textboxes (CurrencyInput/PercentInput) are the quick-fill row.
    const textboxes = screen.getAllByRole("textbox");
    const qfIncomeInput = textboxes[0];
    const qfGrowthInput = textboxes[3];

    fireEvent.change(startYearInput, { target: { value: "2026" } });
    fireEvent.change(endYearInput, { target: { value: "2028" } });
    fireEvent.change(qfIncomeInput, { target: { value: "100000" } });
    fireEvent.change(qfGrowthInput, { target: { value: "10" } });

    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    await save();

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]?.body as string,
    );
    const r26 = body.overrides.find((o: { year: number }) => o.year === 2026);
    const r27 = body.overrides.find((o: { year: number }) => o.year === 2027);
    const r28 = body.overrides.find((o: { year: number }) => o.year === 2028);
    expect(r26.incomeAmount).toBe(100000);
    expect(r27.incomeAmount).toBe(110000);
    expect(r28.incomeAmount).toBe(121000);
  });

  it("Distribution 100% button fills every year with 1.0", async () => {
    const { save } = renderWithSave();
    fireEvent.click(screen.getByRole("button", { name: "100%" }));
    await save();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]?.body as string,
    );
    expect(body.overrides).toHaveLength(3); // 2026, 2027, 2028
    for (const o of body.overrides) {
      expect(o.distributionPercent).toBe(1);
    }
  });

  it("Distribution 0% button fills every year with 0", async () => {
    const { save } = renderWithSave();
    fireEvent.click(screen.getByRole("button", { name: "0%" }));
    await save();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]?.body as string,
    );
    expect(body.overrides).toHaveLength(3);
    for (const o of body.overrides) {
      expect(o.distributionPercent).toBe(0);
    }
  });

  it("0%/100% buttons are not rendered for trust entities", () => {
    render(<FlowScheduleGrid {...baseProps} entityType="trust" />);
    expect(screen.queryByRole("button", { name: "0%" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "100%" })).not.toBeInTheDocument();
  });
});
