// @vitest-environment jsdom
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import BusinessFlowsTab from "../business-flows-tab";
import type { BusinessFlowRow } from "../business-flows-tab";

const submitMock = vi.fn();

vi.mock("@/hooks/use-scenario-writer", () => ({
  useScenarioWriter: () => ({
    submit: submitMock,
    scenarioActive: false,
  }),
}));

vi.mock("@/hooks/use-scenario-state", () => ({
  useScenarioState: () => ({
    scenarioId: null,
    setScenario: vi.fn(),
  }),
}));

beforeEach(() => {
  submitMock.mockReset();
  submitMock.mockResolvedValue({
    ok: true,
    json: async () => ({}),
  });
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, count: 0 }),
  }) as unknown as typeof fetch;
});

const baseIncome: BusinessFlowRow = {
  id: "inc-1",
  name: "LLC Income",
  annualAmount: 200_000,
  ownerAccountId: "biz-1",
  startYear: 2026,
  endYear: 2050,
  growthRate: 0,
  inflationStartYear: 2026,
};

const baseExpense: BusinessFlowRow = {
  id: "exp-1",
  name: "LLC Expense",
  annualAmount: 60_000,
  ownerAccountId: "biz-1",
  startYear: 2026,
  endYear: 2050,
  growthRate: 0,
  inflationStartYear: 2026,
};

const baseProps = {
  clientId: "client-1",
  businessId: "biz-1",
  incomes: [baseIncome],
  expenses: [baseExpense],
  hidden: false,
  flowMode: "annual" as const,
  planStartYear: 2026,
  planEndYear: 2028,
  primaryClientBirthYear: 1964,
  distributionPolicyPercent: 0.5,
  taxTreatment: "qbi" as const,
  initialFlowOverrides: [],
  onScheduleSaveBindingChange: undefined,
  onOpenAddIncome: () => {},
  onOpenAddExpense: () => {},
  onEditIncome: () => {},
  onEditExpense: () => {},
};

describe("BusinessFlowsTab", () => {
  it("renders the annual list of owned incomes and expenses", () => {
    render(<BusinessFlowsTab {...baseProps} />);
    expect(screen.getByText("LLC Income")).toBeInTheDocument();
    expect(screen.getByText("LLC Expense")).toBeInTheDocument();
    // Net annual flow = 200k - 60k = 140k, formatted as $140,000
    expect(screen.getByText(/\$140,000/)).toBeInTheDocument();
  });

  it("renders the Annual ↔ Schedule toggle when plan context is provided", () => {
    render(<BusinessFlowsTab {...baseProps} />);
    expect(
      screen.getByRole("button", { name: /annual \+ growth/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /custom schedule/i }),
    ).toBeInTheDocument();
  });

  it("hides the toggle when plan context is missing", () => {
    render(
      <BusinessFlowsTab
        {...baseProps}
        flowMode={undefined}
        planStartYear={undefined}
        planEndYear={undefined}
        primaryClientBirthYear={undefined}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /annual \+ growth/i }),
    ).not.toBeInTheDocument();
  });

  it("switching to Custom schedule PUTs flowMode to the account route", async () => {
    render(<BusinessFlowsTab {...baseProps} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /custom schedule/i }));
    });
    await waitFor(() => expect(submitMock).toHaveBeenCalled());
    const [edit, fallback] = submitMock.mock.calls[0];
    expect(edit.targetKind).toBe("account");
    expect(edit.targetId).toBe("biz-1");
    expect(edit.desiredFields).toEqual({ flowMode: "schedule" });
    expect(fallback.url).toBe("/api/clients/client-1/accounts/biz-1");
    expect(fallback.method).toBe("PUT");
  });

  it("reverts to Annual on PUT failure", async () => {
    submitMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "boom" }),
    });
    render(<BusinessFlowsTab {...baseProps} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /custom schedule/i }));
    });
    await waitFor(() => {
      // After the revert, the Annual button is back in the active style.
      const annual = screen.getByRole("button", { name: /annual \+ growth/i });
      expect(annual.className).toContain("bg-accent");
    });
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });

  it("schedule view renders the grid with the Distribution % column always shown", async () => {
    render(<BusinessFlowsTab {...baseProps} flowMode="schedule" />);
    // Mode toggle is still visible
    expect(screen.getByRole("button", { name: /custom schedule/i })).toBeInTheDocument();
    // Distribution column anchored by the 0%/100% quick-set buttons
    expect(screen.getByRole("button", { name: "0%" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "100%" })).toBeInTheDocument();
  });

  it("schedule view registers a save binding with the parent", async () => {
    const bindings: Array<unknown> = [];
    render(
      <BusinessFlowsTab
        {...baseProps}
        flowMode="schedule"
        onScheduleSaveBindingChange={(b) => bindings.push(b)}
      />,
    );
    // The grid synchronously registers a binding on mount. With saving=false
    // we should see at least one non-null binding pushed.
    await waitFor(() => {
      expect(bindings.some((b) => b !== null)).toBe(true);
    });
  });

  it("DistributionAndTax section saves business fields via the account PUT", async () => {
    render(<BusinessFlowsTab {...baseProps} />);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /save/i })[0]);
    });
    await waitFor(() => expect(submitMock).toHaveBeenCalled());
    const [edit, fallback] = submitMock.mock.calls[0];
    expect(edit.targetKind).toBe("account");
    expect(edit.targetId).toBe("biz-1");
    expect(edit.desiredFields).toEqual({
      distributionPolicyPercent: 0.5,
      businessTaxTreatment: "qbi",
    });
    expect(fallback.url).toBe("/api/clients/client-1/accounts/biz-1");
  });
});
