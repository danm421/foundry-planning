// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { EstateSummaryView } from "../estate-summary-view";
import type { EstateSummaryPageData } from "@/lib/presentations/pages/estate-summary/view-model";

const POPULATED: EstateSummaryPageData = {
  title: "Estate Summary",
  subtitle: "Base · As of 2026 vs. End of Life",
  isMarried: true,
  isEmpty: false,
  kpis: {
    grossEstateToday: 4_200_000,
    grossEstateEol: 6_800_000,
    taxAndCostsToday: 480_000,
    taxAndCostsEol: 1_360_000,
    netToHeirsToday: 3_720_000,
    netToHeirsEol: 5_440_000,
    shrinkageToday: 0.11,
    shrinkageEol: 0.2,
  },
  chart: [
    {
      label: "Today",
      netToHeirs: 3_720_000,
      federal: 260_000,
      state: 120_000,
      probate: 60_000,
      ird: 40_000,
      debts: 30_000,
      total: 4_230_000,
    },
    {
      label: "End of Life",
      netToHeirs: 5_440_000,
      federal: 820_000,
      state: 360_000,
      probate: 110_000,
      ird: 70_000,
      debts: 50_000,
      total: 6_850_000,
    },
  ],
  todayRows: [
    {
      label: "First death",
      decedentName: "Jordan Avery",
      deathOrder: 1,
      year: 2026,
      grossEstate: 2_100_000,
      federal: 0,
      state: 60_000,
      probate: 30_000,
      ird: 20_000,
      netAfterTax: 1_990_000,
    },
    {
      label: "Second death",
      decedentName: "Riley Avery",
      deathOrder: 2,
      year: 2026,
      grossEstate: 2_100_000,
      federal: 260_000,
      state: 60_000,
      probate: 30_000,
      ird: 20_000,
      netAfterTax: 1_730_000,
    },
  ],
  eolRows: [
    {
      label: "First death",
      decedentName: "Jordan Avery",
      deathOrder: 1,
      year: 2049,
      grossEstate: 3_400_000,
      federal: 0,
      state: 180_000,
      probate: 55_000,
      ird: 35_000,
      netAfterTax: 3_130_000,
    },
    {
      label: "Second death",
      decedentName: "Riley Avery",
      deathOrder: 2,
      year: 2055,
      grossEstate: 3_400_000,
      federal: 820_000,
      state: 180_000,
      probate: 55_000,
      ird: 35_000,
      netAfterTax: 2_310_000,
    },
  ],
  heirs: [
    {
      key: "child-1",
      recipientLabel: "Casey Avery",
      todayOutright: 1_860_000,
      todayInTrust: 0,
      todayTotal: 1_860_000,
      eolOutright: 2_000_000,
      eolInTrust: 720_000,
      eolTotal: 2_720_000,
    },
    {
      key: "child-2",
      recipientLabel: "Morgan Avery",
      todayOutright: 0,
      todayInTrust: 1_860_000,
      todayTotal: 1_860_000,
      eolOutright: 2_720_000,
      eolInTrust: 0,
      eolTotal: 2_720_000,
    },
  ],
  narrative: [
    "Estate shrinkage rises from 11% today to 20% at end of life.",
    "Federal estate tax appears only at the second death.",
  ],
};

describe("EstateSummaryView", () => {
  it("renders a populated fixture", () => {
    const { container } = render(<EstateSummaryView data={POPULATED} />);
    const text = container.textContent ?? "";
    expect(text).toContain("Estate Summary");
    expect(text).toContain("Casey Avery");
    expect(text).toContain("Jordan Avery");
    expect(text).toContain("Estate shrinkage rises from 11% today to 20% at end of life.");
  });

  it("renders the empty state", () => {
    const data = { isEmpty: true, title: "Estate Summary", subtitle: "" } as never;
    const { getByText } = render(<EstateSummaryView data={data} />);
    expect(getByText("No data for this scenario yet.")).toBeTruthy();
  });
});
