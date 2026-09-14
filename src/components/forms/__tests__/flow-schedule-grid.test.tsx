// @vitest-environment jsdom
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import FlowScheduleGrid, {
  type ScheduleSaveBinding,
  type ScheduleSaveInput,
  type ScheduleTarget,
} from "../flow-schedule-grid";

/**
 * Renders the grid and exposes a `save()` helper. The grid no longer owns its
 * Save button — the dialog footer does — so tests drive saves through the
 * binding the grid registers with its parent.
 */
function renderWithSave(
  overrideProps: Partial<React.ComponentProps<typeof FlowScheduleGrid>> = {},
) {
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
      let result: Awaited<ReturnType<ScheduleSaveBinding["save"]>> | undefined;
      await act(async () => {
        result = await ref.current!.save();
      });
      return result!;
    },
  };
}

const baseProps = {
  clientId: "client-1",
  target: {
    kind: "entity",
    entityId: "ent-1",
    entityType: "llc",
  } satisfies ScheduleTarget,
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
    render(
      <FlowScheduleGrid
        {...baseProps}
        target={{ kind: "entity", entityId: "ent-1", entityType: "trust" }}
      />,
    );
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
    render(
      <FlowScheduleGrid
        {...baseProps}
        target={{ kind: "entity", entityId: "ent-1", entityType: "trust" }}
      />,
    );
    expect(screen.queryByRole("button", { name: "0%" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "100%" })).not.toBeInTheDocument();
  });

  it("account target always shows Distribution % column and saves to the account route", async () => {
    const { save } = renderWithSave({
      target: { kind: "account", accountId: "acct-1" },
    });
    expect(screen.getByRole("button", { name: "0%" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "100%" })).toBeInTheDocument();
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[incomeInputForYearIndex(0)], {
      target: { value: "500000" },
    });
    await save();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/clients/client-1/accounts/acct-1/flow-overrides");
    expect(call[0]).toContain("scenarioId=scenario-1");
  });

  it("account target sums an array baseline across multiple owned flows", () => {
    render(
      <FlowScheduleGrid
        {...baseProps}
        target={{ kind: "account", accountId: "acct-1" }}
        income={[
          { annualAmount: 60_000, growthRate: 0, startYear: 2026, endYear: 2050, inflationStartYear: 2026 },
          { annualAmount: 40_000, growthRate: 0, startYear: 2026, endYear: 2050, inflationStartYear: 2026 },
        ]}
        expense={null}
      />,
    );
    // Two summed incomes (60k + 40k = 100k) should appear as a placeholder
    // on the per-year row. Match the formatted currency string.
    const placeholders = screen
      .getAllByRole("textbox")
      .map((el) => (el as HTMLInputElement).placeholder);
    expect(placeholders).toContain("$100,000");
  });

  // ── saveOverrides seam ─────────────────────────────────────────────────────

  it("hands an injected saveOverrides the full merged rows and never PUTs", async () => {
    const saveOverrides = vi.fn<(input: ScheduleSaveInput) => Promise<void>>(
      async () => {},
    );
    const { save } = renderWithSave({ saveOverrides });
    const inputs = screen.getAllByRole("textbox");
    // 2026 income and 2026 distribution %, so the row carries two of three.
    fireEvent.change(inputs[incomeInputForYearIndex(0)], {
      target: { value: "250000" },
    });
    fireEvent.change(inputs[incomeInputForYearIndex(0) + 2], {
      target: { value: "50" },
    });
    expect(await save()).toEqual({ ok: true });

    expect(saveOverrides).toHaveBeenCalledTimes(1);
    // Whole merged row, all three keys — a per-cell diff would wipe the others.
    expect(saveOverrides.mock.calls[0][0].overrides).toEqual([
      {
        year: 2026,
        incomeAmount: 250000,
        expenseAmount: null,
        distributionPercent: 0.5,
      },
    ]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("tells an injected saveOverrides every year the grid covers, so a cleared year is visible", async () => {
    const saveOverrides = vi.fn<(input: ScheduleSaveInput) => Promise<void>>(
      async () => {},
    );
    const { save } = renderWithSave({
      saveOverrides,
      initialOverrides: [
        {
          year: 2027,
          incomeAmount: 90_000,
          expenseAmount: null,
          distributionPercent: null,
        },
      ],
    });
    // Clear 2027 — over HTTP its absence means "cleared", and a per-year writer
    // has to be able to work that out too.
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[incomeInputForYearIndex(1)], {
      target: { value: "" },
    });
    await save();

    const input = saveOverrides.mock.calls[0][0];
    expect(input.overrides).toEqual([]);
    expect(input.years).toEqual([2026, 2027, 2028]);
  });

  it("reports a stored override year outside the plan span, which the default PUT would delete", async () => {
    const saveOverrides = vi.fn<(input: ScheduleSaveInput) => Promise<void>>(
      async () => {},
    );
    const { save } = renderWithSave({
      saveOverrides,
      // 2025 predates planStartYear (2026) — a leftover from before the plan
      // was re-based. The whole-grid PUT deletes every row for the entity, so
      // it goes; an injected save has to be able to reach the same end state.
      initialOverrides: [
        {
          year: 2025,
          incomeAmount: 42_000,
          expenseAmount: null,
          distributionPercent: null,
        },
      ],
    });
    // The grid still renders only the plan span — widening the seam must not
    // put an un-editable 2025 row on screen.
    expect(screen.queryByText(/2025/)).not.toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();

    await save();

    const input = saveOverrides.mock.calls[0][0];
    expect(input.years).toEqual([2025, 2026, 2027, 2028]);
    // 2025 renders nowhere, so it can never carry a figure into `overrides`.
    expect(input.overrides).toEqual([]);
  });

  it("reports a rejected injected saveOverrides the way it reports a failed PUT", async () => {
    const saveOverrides = vi
      .fn<(input: ScheduleSaveInput) => Promise<void>>()
      .mockRejectedValue(new Error("entity is not in the working tree"));
    const { save } = renderWithSave({ saveOverrides });
    expect(await save()).toEqual({
      ok: false,
      error: "entity is not in the working tree",
    });
    expect(
      screen.getByText("entity is not in the working tree"),
    ).toBeInTheDocument();
  });
});
