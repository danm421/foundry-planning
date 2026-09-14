// @vitest-environment jsdom
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import FlowsTab, { type ScheduleSaveBinding, type ScheduleSaveInput } from "../flows-tab";

const submitMock = vi.fn();
let fetchMock: ReturnType<typeof vi.fn>;

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
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  global.fetch = fetchMock as unknown as typeof fetch;
});

const baseProps = {
  clientId: "client-1",
  entityId: "ent-1",
  entityName: "Acme LLC",
  entityType: "llc" as const,
  income: null,
  expense: null,
  distributionPolicyPercent: null,
  taxTreatment: "ordinary" as const,
  flowMode: "annual" as const,
  planStartYear: 2026,
  defaultEndYear: 2050,
  planEndYear: 2050,
  primaryClientBirthYear: 1964,
  initialFlowOverrides: [],
};

describe("FlowsTab", () => {
  it("shows an Add income affordance when no income exists", () => {
    render(<FlowsTab {...baseProps} />);
    expect(screen.getByRole("button", { name: /add income/i })).toBeInTheDocument();
  });

  it("renders existing income summary when one is provided", () => {
    render(
      <FlowsTab
        {...baseProps}
        income={{
          id: "inc-1",
          name: "Acme — Income",
          annualAmount: 100000,
          startYear: 2026,
          endYear: 2050,
          growthRate: 0.03,
          growthSource: "inflation",
          inflationStartYear: 2026,
        }}
      />
    );
    expect(screen.getByText("Acme — Income")).toBeInTheDocument();
    expect(screen.getByText(/\$100,000/)).toBeInTheDocument();
  });

  it("renders Distribution & Tax section for business types only", () => {
    const { rerender } = render(<FlowsTab {...baseProps} entityType="llc" />);
    expect(screen.getByText(/distribution policy/i)).toBeInTheDocument();
    expect(screen.getByText(/tax treatment/i)).toBeInTheDocument();

    rerender(<FlowsTab {...baseProps} entityType="trust" />);
    expect(screen.queryByText(/distribution policy/i)).not.toBeInTheDocument();
  });

  it("Annual mode shows the income/expense/distribution forms (no inline grid)", () => {
    render(<FlowsTab {...baseProps} />);
    expect(screen.getByRole("button", { name: /add income/i })).toBeInTheDocument();
    // Quick fill panel only exists inside FlowScheduleGrid (schedule mode).
    expect(screen.queryByText(/quick fill/i)).not.toBeInTheDocument();
  });

  it("Schedule mode renders the inline grid in place of the income/expense forms", () => {
    render(<FlowsTab {...baseProps} flowMode="schedule" />);
    expect(screen.getByText(/quick fill/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add income/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/distribution policy/i)).not.toBeInTheDocument();
  });

  it("clicking 'Custom schedule' submits a flowMode edit through writer.submit", async () => {
    render(<FlowsTab {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /custom schedule/i }));
    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    const [edit, baseFallback] = submitMock.mock.calls[0];
    expect(edit).toMatchObject({
      op: "edit",
      targetKind: "entity",
      targetId: "ent-1",
      desiredFields: { flowMode: "schedule" },
    });
    expect(baseFallback).toMatchObject({
      url: "/api/clients/client-1/entities/ent-1",
      method: "PUT",
      body: { flowMode: "schedule" },
    });
  });

  it("routes Distribution & Tax saves through writer.submit with targetKind=entity", async () => {
    render(
      <FlowsTab
        {...baseProps}
        distributionPolicyPercent={0.25}
        taxTreatment="qbi"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    const [edit, baseFallback] = submitMock.mock.calls[0];
    expect(edit).toMatchObject({
      op: "edit",
      targetKind: "entity",
      targetId: "ent-1",
      desiredFields: { distributionPolicyPercent: 0.25, taxTreatment: "qbi" },
    });
    expect(baseFallback).toMatchObject({
      url: "/api/clients/client-1/entities/ent-1",
      method: "PUT",
    });
  });

  // ── Solver seams ───────────────────────────────────────────────────────────

  it("routes entity edits through an injected writer instead of the hook's", async () => {
    const injected = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    render(
      <FlowsTab
        {...baseProps}
        writer={{ submit: injected, submitDirect: vi.fn(), scenarioActive: false }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /custom schedule/i }));
    await waitFor(() => expect(injected).toHaveBeenCalledTimes(1));
    expect(injected.mock.calls[0][0]).toMatchObject({
      op: "edit",
      targetKind: "entity",
      targetId: "ent-1",
      desiredFields: { flowMode: "schedule" },
    });
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("fires the ensure-cash self-heal POST by default", async () => {
    render(<FlowsTab {...baseProps} />);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/clients/client-1/entities/ent-1/ensure-cash",
        { method: "POST" },
      ),
    );
  });

  it("skipEnsureCash suppresses the ensure-cash POST", () => {
    render(<FlowsTab {...baseProps} skipEnsureCash />);
    // Positive render assertion first: a blank tab would pass vacuously.
    expect(screen.getByRole("button", { name: /add income/i })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards saveOverrides to the per-year schedule grid", async () => {
    const saveOverrides = vi.fn<(input: ScheduleSaveInput) => Promise<void>>(
      async () => {},
    );
    const binding: { current: ScheduleSaveBinding | null } = { current: null };
    render(
      <FlowsTab
        {...baseProps}
        flowMode="schedule"
        skipEnsureCash
        saveOverrides={saveOverrides}
        onScheduleSaveBindingChange={(b) => {
          binding.current = b;
        }}
      />,
    );
    expect(screen.getByText(/quick fill/i)).toBeInTheDocument();
    if (!binding.current) throw new Error("grid never registered a save binding");
    await act(async () => {
      await binding.current!.save();
    });

    expect(saveOverrides).toHaveBeenCalledTimes(1);
    expect(saveOverrides.mock.calls[0][0].years).toEqual([
      2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035, 2036, 2037,
      2038, 2039, 2040, 2041, 2042, 2043, 2044, 2045, 2046, 2047, 2048, 2049,
      2050,
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
