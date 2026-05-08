// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import FlowsTab from "../flows-tab";

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

  it("Schedule button is enabled in base mode (no scenarioId)", () => {
    render(<FlowsTab {...baseProps} />);
    const btn = screen.getByRole("button", { name: /schedule/i });
    expect(btn).not.toBeDisabled();
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
});
