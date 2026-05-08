// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import FlowsTab from "../flows-tab";

vi.mock("@/hooks/use-scenario-writer", () => ({
  useScenarioWriter: () => ({
    submit: vi.fn().mockResolvedValue({ ok: true, json: () => ({}) }),
    scenarioActive: false,
  }),
}));

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
});
