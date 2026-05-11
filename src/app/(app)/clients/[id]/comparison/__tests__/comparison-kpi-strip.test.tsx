// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ComparisonKpiStrip } from "../comparison-kpi-strip";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

function makePlan(opts: {
  endingNW: number;
  lifetimeTotal: number;
  fedEstateTax: number;
  estateAdmin: number;
  toHeirs: number;
  yearsSurvives: number;
}): ComparisonPlan {
  // Years all positive so computeYearsPortfolioSurvives counts every one of
  // them. The final year's portfolioAssets.total is what computeEndingNetWorth
  // returns. Length therefore equals desired yearsSurvives.
  const years = Array.from({ length: opts.yearsSurvives }, () => ({
    year: 2025,
    portfolioAssets: { total: opts.endingNW || 1 },
  }));
  if (years.length > 0) {
    years[years.length - 1] = {
      year: 2025,
      portfolioAssets: { total: opts.endingNW },
    };
  }
  return {
    index: 0,
    isBaseline: false,
    ref: { kind: "scenario", id: "x", toggleState: {} },
    id: "x",
    label: "X",
    tree: { client: { firstName: "F", lastName: "L", dateOfBirth: "1970-01-01" } } as never,
    result: {
      years: years as never,
      firstDeathEvent: {
        federalEstateTax: opts.fedEstateTax,
        stateEstateTax: 0,
        estateAdminExpenses: opts.estateAdmin,
      },
      secondDeathEvent: undefined,
    } as never,
    lifetime: {
      total: opts.lifetimeTotal,
      byBucket: {
        regularFederalIncomeTax: 0,
        capitalGainsTax: 0,
        amtAdditional: 0,
        niit: 0,
        additionalMedicare: 0,
        fica: 0,
        stateTax: 0,
      },
    },
    liquidityRows: [],
    finalEstate: {
      year: 2050,
      totalToHeirs: opts.toHeirs,
      taxesAndExpenses: 0,
      charity: 0,
    } as never,
    panelData: null,
  };
}

describe("ComparisonKpiStrip", () => {
  it("renders six tiles with deltas computed from the plans array", () => {
    const p1 = makePlan({
      endingNW: 0,
      lifetimeTotal: 340_000,
      fedEstateTax: 520_000,
      estateAdmin: 0,
      toHeirs: 0,
      yearsSurvives: 0,
    });
    const p2 = makePlan({
      endingNW: 2_400_000,
      lifetimeTotal: 0,
      fedEstateTax: 0,
      estateAdmin: 0,
      toHeirs: 1_800_000,
      yearsSurvives: 5,
    });
    const { container } = render(
      <ComparisonKpiStrip plans={[p1, p2]} mcSuccessByIndex={{ 0: 0.5, 1: 0.62 }} />,
    );
    expect(container.textContent).toContain("Ending NW");
    expect(container.textContent).toContain("MC Success");
    expect(container.textContent).toContain("Lifetime Tax");
    expect(container.textContent).toContain("To Heirs");
    expect(container.textContent).toContain("Estate Tax");
    expect(container.textContent).toContain("Years Survives");
    expect(container.textContent).toContain("+$2,400,000");
    expect(container.textContent).toContain("+12 pts");
    expect(container.textContent).toContain("−$340,000");
  });

  it("shows '…' for the MC tile when no MC success rates have been recorded", () => {
    const plan = makePlan({
      endingNW: 0,
      lifetimeTotal: 0,
      fedEstateTax: 0,
      estateAdmin: 0,
      toHeirs: 0,
      yearsSurvives: 0,
    });
    const { container } = render(
      <ComparisonKpiStrip plans={[plan, plan]} mcSuccessByIndex={{}} />,
    );
    expect(container.textContent).toContain("…");
  });
});
