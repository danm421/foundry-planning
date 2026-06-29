// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TaxSummaryView } from "../tax-summary-view";
import type { TaxSummaryPageData } from "@/lib/presentations/pages/tax-summary/view-model";

const POPULATED: TaxSummaryPageData = {
  title: "Tax Summary",
  subtitle: "Base · Lifetime 2025–2055",
  isEmpty: false,
  bracketMode: true,
  kpis: {
    lifetimeFederal: 840_000,
    lifetimeState: 120_000,
    lifetimeCapGains: 60_000,
    lifetimeTotal: 1_020_000,
    effectiveRate: 0.22,
  },
  chart: [
    { year: 2025, federalOrdinary: 30_000, capGains: 2_000, state: 4_000, total: 36_000 },
    { year: 2026, federalOrdinary: 32_000, capGains: 2_500, state: 4_200, total: 38_700 },
  ],
  bracket: {
    yearsBelowLow: 5,
    yearsAboveHigh: 3,
    lowThreshold: 0.22,
    highThreshold: 0.32,
    minRate: 0.12,
    maxRate: 0.35,
  },
  composition: {
    year: 2042,
    roth: 300_000,
    preTax: 500_000,
    taxable: 200_000,
    total: 1_000_000,
  },
  narrative: ["Lifetime total tax is $1.0M at a 22% effective rate.", "Roth conversions may help reduce bracket exposure."],
};

describe("TaxSummaryView", () => {
  it("renders a populated fixture", () => {
    const { container } = render(<TaxSummaryView data={POPULATED} />);
    expect(container.textContent).toContain("Tax Summary");
    expect(container.textContent).toContain("22%");
    expect(container.textContent).toContain("Bracket exposure");
  });

  it("renders the empty state", () => {
    const data = { isEmpty: true, title: "Tax Summary", subtitle: "" } as never;
    const { getByText } = render(<TaxSummaryView data={data} />);
    expect(getByText("No data for this scenario yet.")).toBeTruthy();
  });
});
