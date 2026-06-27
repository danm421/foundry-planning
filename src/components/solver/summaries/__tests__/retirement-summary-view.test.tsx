// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { RetirementSummaryView } from "../retirement-summary-view";
import type { RetirementSummaryPageData } from "@/lib/presentations/pages/retirement-summary/view-model";

// ── Minimal ChartSpec for the cashFlowChartSpec field ──────────────────────
const CHART_SPEC: RetirementSummaryPageData["cashFlowChartSpec"] = {
  kind: "stackedBarWithLine",
  width: 500,
  height: 210,
  margin: { top: 10, right: 10, bottom: 30, left: 60 },
  xAxis: {
    domain: [2030, 2031, 2032],
    ticks: [2030, 2031, 2032],
    labelFormat: (v: number) => String(v),
  },
  yAxis: {
    domain: [0, 200_000],
    ticks: [0, 100_000, 200_000],
    labelFormat: (v: number) => `$${v}`,
    gridlineColor: "#2b2f3a",
  },
  stacks: [
    {
      seriesId: "income.socialSecurity",
      label: "Social Security",
      color: "#2c5fa8",
      values: [24_000, 25_000, 26_000],
    },
    {
      seriesId: "income.salaries",
      label: "Salaries",
      color: "#2a8a5e",
      values: [0, 0, 0],
    },
  ],
  lines: [
    {
      seriesId: "totalExpenses",
      label: "Total Expenses",
      color: "#f4f5f7",
      strokeWidth: 2,
      values: [80_000, 82_000, 84_000],
    },
  ],
  markers: [],
  legend: {
    position: "bottom",
    items: [
      { label: "Social Security", color: "#2c5fa8", kind: "swatch" },
      { label: "Total Expenses", color: "#f4f5f7", kind: "line" },
    ],
  },
};

const POPULATED: RetirementSummaryPageData = {
  title: "Retirement Summary",
  subtitle: "Base · Retire age 65 in 2030 · through 2055",
  isEmpty: false,
  isMarried: true,
  kpis: {
    monteCarlo: "92%",
    liquidNow: 500_000,
    liquidRetirement: 1_200_000,
    liquidEndOfLife: 800_000,
    retirementAge: 65,
    retirementYear: 2030,
    totalSpend: 2_400_000,
  },
  liquid: { now: 500_000, retirement: 1_200_000, endOfLife: 800_000 },
  bars: [
    { year: 2025, cash: 50_000, taxable: 200_000, retirement: 250_000, total: 500_000 },
    { year: 2030, cash: 60_000, taxable: 400_000, retirement: 740_000, total: 1_200_000 },
    { year: 2055, cash: 20_000, taxable: 300_000, retirement: 480_000, total: 800_000 },
  ],
  byType: { cash: 60_000, taxable: 400_000, retirement: 740_000, total: 1_200_000 },
  byTaxType: { roth: 200_000, preTax: 540_000, taxable: 400_000, total: 1_200_000 - 60_000 },
  funding: {
    socialSecurity: 480_000,
    otherIncome: 120_000,
    rmds: 200_000,
    withdrawalsCash: 50_000,
    withdrawalsTaxable: 300_000,
    withdrawalsPreTax: 400_000,
    withdrawalsRoth: 150_000,
    shortfall: 0,
    totalSpending: 2_400_000,
    totalFunded: 2_400_000,
  },
  fundingSources: [
    { label: "Social Security", value: 480_000 },
    { label: "Ongoing income", value: 120_000 },
    { label: "RMDs", value: 200_000 },
    { label: "Cash withdrawals", value: 50_000 },
    { label: "Taxable withdrawals", value: 300_000 },
    { label: "Pre-tax withdrawals", value: 400_000 },
    { label: "Roth withdrawals", value: 150_000 },
  ],
  socialSecurity: {
    client: {
      name: "Alex Smith",
      piaMonthly: 2_000,
      claimAge: 67,
      colaPct: 0.025,
      alreadyClaiming: false,
      receivedMonthly: null,
      ladder: [
        { age: 62, monthly: 1_400, selected: false },
        { age: 65, monthly: 1_733, selected: false },
        { age: 67, monthly: 2_000, selected: true },
        { age: 70, monthly: 2_480, selected: false },
      ],
    },
    spouse: {
      name: "Jordan Smith",
      piaMonthly: 1_500,
      claimAge: 67,
      colaPct: 0.025,
      alreadyClaiming: false,
      receivedMonthly: null,
      ladder: [
        { age: 62, monthly: 1_050, selected: false },
        { age: 67, monthly: 1_500, selected: true },
        { age: 70, monthly: 1_860, selected: false },
      ],
    },
  },
  living: { today: 72_000, retirement: 96_000 },
  otherExpenses: { insurance: 12_000, realEstate: 8_000, liabilities: 0, other: 0 },
  income: [
    { id: "rental-1", label: "Rental income", type: "rental", amount: 24_000 },
  ],
  transactions: [
    { year: 2032, name: "Vacation property", kind: "sale", amount: 450_000 },
  ],
  narrative: [
    "Monte Carlo success rate of 92% gives this plan a strong probability of funding retirement through age 90.",
    "Social Security claiming at 67 generates $2,000/mo — delaying to 70 would add 24% more per month.",
  ],
  cashFlowChartSpec: CHART_SPEC,
};

describe("RetirementSummaryView", () => {
  it("renders a populated fixture", () => {
    const { container } = render(<RetirementSummaryView data={POPULATED} />);
    expect(container.textContent).toContain("Retirement Summary");
    // kpis
    expect(container.textContent).toContain("92%"); // monteCarlo — verbatim string, not computed
    expect(container.textContent).toContain("Monte Carlo");
    expect(container.textContent).toContain("65"); // retirementAge
    // portfolio trajectory
    expect(container.textContent).toContain("Portfolio assets over time");
    // assets at retirement
    expect(container.textContent).toContain("Assets at retirement");
    // social security
    expect(container.textContent).toContain("Social Security");
    expect(container.textContent).toContain("Alex Smith");
    expect(container.textContent).toContain("Jordan Smith");
    // spending section
    expect(container.textContent).toContain("Retirement spending");
    // income section
    expect(container.textContent).toContain("Income in retirement");
    expect(container.textContent).toContain("Rental income");
    // transactions
    expect(container.textContent).toContain("Asset transactions");
    expect(container.textContent).toContain("Vacation property");
    // narrative
    expect(container.textContent).toContain("Takeaways");
  });

  it("renders the empty state", () => {
    const data = { isEmpty: true, title: "Retirement Summary", subtitle: "" } as never;
    const { getByText } = render(<RetirementSummaryView data={data} />);
    expect(getByText("No data for this scenario yet.")).toBeTruthy();
  });
});
