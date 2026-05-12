// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { kpiWidget } from "../kpi";
import type { ComparisonPlan } from "../../build-comparison-plans";
import type { ComparisonWidgetContext } from "../types";

function mockPlan(
  overrides: Partial<{
    endingNetWorth: number;
    lifetimeTaxTotal: number;
    totalToHeirs: number;
    finalAge: number;
    finalYear: number;
  }> = {},
): ComparisonPlan {
  const {
    endingNetWorth = 5_000_000,
    lifetimeTaxTotal = 2_000_000,
    totalToHeirs = 3_500_000,
    finalAge = 104,
    finalYear = 2065,
  } = overrides;
  return {
    id: "plan-base",
    label: "Base",
    result: {
      years: [
        { year: 2026, ages: { client: 65 }, portfolioAssets: { total: 1_000_000 } },
        { year: finalYear, ages: { client: finalAge }, portfolioAssets: { total: endingNetWorth } },
      ],
    },
    lifetime: { total: lifetimeTaxTotal, byBucket: {} },
    finalEstate: { totalToHeirs },
  } as unknown as ComparisonPlan;
}

const mockCtx = (
  plans: ComparisonPlan[],
  config: { metric: string },
  mc: ComparisonWidgetContext["mc"] = null,
): ComparisonWidgetContext => ({
  instanceId: "w-1",
  clientId: "client-1",
  plans,
  mc,
  config,
  yearRange: null,
  editing: false,
});

describe("kpi widget", () => {
  it("declares correct contract", () => {
    expect(kpiWidget.kind).toBe("kpi");
    expect(kpiWidget.category).toBe("kpis");
    expect(kpiWidget.scenarios).toBe("one");
    expect(kpiWidget.defaultPlanCount).toBe(1);
  });

  it("renders End Net Worth from the bound plan's last portfolioAssets.total", () => {
    render(<>{kpiWidget.render(mockCtx([mockPlan()], { metric: "endNetWorth" }))}</>);
    expect(screen.getByText(/5(\.0)?M/i)).toBeInTheDocument();
    expect(screen.getByText(/End Net Worth/i)).toBeInTheDocument();
  });

  it("renders Lifetime Tax from plan.lifetime.total", () => {
    render(<>{kpiWidget.render(mockCtx([mockPlan()], { metric: "lifetimeTax" }))}</>);
    expect(screen.getByText(/2(\.0)?M/i)).toBeInTheDocument();
    expect(screen.getByText(/Lifetime Tax/i)).toBeInTheDocument();
  });

  it("renders Net to Heirs from plan.finalEstate.totalToHeirs", () => {
    render(<>{kpiWidget.render(mockCtx([mockPlan()], { metric: "netToHeirs" }))}</>);
    expect(screen.getByText(/3\.5M/i)).toBeInTheDocument();
    expect(screen.getByText(/Net to Heirs/i)).toBeInTheDocument();
  });

  it("renders Longevity Age from the last projection year", () => {
    render(<>{kpiWidget.render(mockCtx([mockPlan({ finalAge: 92 })], { metric: "longevityAge" }))}</>);
    expect(screen.getByText("92")).toBeInTheDocument();
    expect(screen.getByText(/Longevity Age/i)).toBeInTheDocument();
  });

  it("renders Success Probability from mc.successByIndex", () => {
    const ctx = mockCtx(
      [mockPlan()],
      { metric: "successProbability" },
      {
        perPlan: [],
        threshold: 0.9,
        successByIndex: { 0: 0.78 },
        planStartYear: 2026,
        clientBirthYear: 1961,
      },
    );
    render(<>{kpiWidget.render(ctx)}</>);
    expect(screen.getByText(/78%/)).toBeInTheDocument();
    expect(screen.getByText(/Success/i)).toBeInTheDocument();
  });

  it("renders Net to Heirs as $0 when finalEstate is null", () => {
    const plan = mockPlan();
    (plan as unknown as { finalEstate: unknown }).finalEstate = null;
    render(<>{kpiWidget.render(mockCtx([plan], { metric: "netToHeirs" }))}</>);
    expect(screen.getByText(/\$0/)).toBeInTheDocument();
  });

  it("renders dash state when bound to zero plans", () => {
    render(<>{kpiWidget.render(mockCtx([], { metric: "endNetWorth" }))}</>);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
