// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { kpiWidget } from "../kpi";
import type { ComparisonPlan } from "../../build-comparison-plans";
import type { ComparisonWidgetContext } from "../types";

const mockPlan = (
  id: string,
  label: string,
  resultOverrides: Record<string, unknown> = {},
): ComparisonPlan =>
  ({
    id,
    label,
    result: {
      years: [
        { year: 2026, ages: { client: 65 }, totalNetWorth: 1_000_000 },
        { year: 2065, ages: { client: 104 }, totalNetWorth: 5_000_000 },
      ],
      summary: { lifetimeTax: 2_000_000, netToHeirs: 3_500_000 },
      ...resultOverrides,
    },
  }) as unknown as ComparisonPlan;

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

  it("renders End Net Worth from the bound plan", () => {
    const ctx = mockCtx(
      [mockPlan("plan-base", "Base")],
      { metric: "endNetWorth" },
    );
    render(<>{kpiWidget.render(ctx)}</>);
    expect(screen.getByText(/5(\.0)?M/i)).toBeInTheDocument();
    expect(screen.getByText(/End Net Worth/i)).toBeInTheDocument();
  });

  it("renders Lifetime Tax from summary", () => {
    const ctx = mockCtx(
      [mockPlan("plan-base", "Base")],
      { metric: "lifetimeTax" },
    );
    render(<>{kpiWidget.render(ctx)}</>);
    expect(screen.getByText(/2(\.0)?M/i)).toBeInTheDocument();
    expect(screen.getByText(/Lifetime Tax/i)).toBeInTheDocument();
  });

  it("renders Net to Heirs from summary", () => {
    const ctx = mockCtx(
      [mockPlan("plan-base", "Base")],
      { metric: "netToHeirs" },
    );
    render(<>{kpiWidget.render(ctx)}</>);
    expect(screen.getByText(/3\.5M/i)).toBeInTheDocument();
    expect(screen.getByText(/Net to Heirs/i)).toBeInTheDocument();
  });

  it("renders Success Probability from mc.successByIndex", () => {
    const plan = mockPlan("plan-base", "Base");
    const ctx = mockCtx(
      [plan],
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

  it("renders Longevity Age from the final projection year", () => {
    const ctx = mockCtx(
      [mockPlan("plan-base", "Base")],
      { metric: "longevityAge" },
    );
    render(<>{kpiWidget.render(ctx)}</>);
    expect(screen.getByText("104")).toBeInTheDocument();
    expect(screen.getByText(/Longevity Age/i)).toBeInTheDocument();
  });

  it("renders an empty/dash state when bound to zero plans", () => {
    const ctx = mockCtx([], { metric: "endNetWorth" });
    render(<>{kpiWidget.render(ctx)}</>);
    expect(screen.getByText(/—|N\/A/)).toBeInTheDocument();
  });

  it("declares needsMc=true at the definition level (page-level MC fetch is gated per-instance by config.metric)", () => {
    expect(kpiWidget.needsMc).toBe(true);
  });
});
