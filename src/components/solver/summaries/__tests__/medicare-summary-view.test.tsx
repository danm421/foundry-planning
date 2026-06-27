// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MedicareSummaryView } from "../medicare-summary-view";
import type { MedicareSummaryPageData } from "@/lib/presentations/pages/medicare-summary/view-model";

const POPULATED: MedicareSummaryPageData = {
  title: "Medicare & IRMAA Summary",
  subtitle: "Base · Medicare years 2030–2055",
  isEmpty: false,
  kpis: {
    lifetimeMedicareCost: 320_000,
    lifetimeIrmaa: 48_000,
    irmaaShare: 0.15,
    irmaaYears: 8,
    enrolledYears: 25,
    peakTier: 2,
    peakTierYear: 2038,
  },
  bars: [
    { year: 2030, base: 8_400, irmaa: 0, total: 8_400, tier: 0 },
    { year: 2031, base: 8_700, irmaa: 1_200, total: 9_900, tier: 1 },
    { year: 2032, base: 9_000, irmaa: 2_400, total: 11_400, tier: 2 },
  ],
  composition: {
    partB: 120_000,
    partD: 40_000,
    medigap: 112_000,
    irmaa: 48_000,
    total: 320_000,
  },
  tierLadder: [
    { tier: 0, thresholdLabel: "Standard premium", years: 17 },
    { tier: 1, thresholdLabel: "≥ $194k", years: 5 },
    { tier: 2, thresholdLabel: "≥ $246k", years: 3 },
  ],
  headroom: { year: 2031, amount: 12_000, nextTier: 2 },
  enrollment: {
    client: { year: 2030, age: 65 },
    spouse: { year: 2032, age: 65 },
  },
  narrative: [
    "Lifetime Medicare cost is $320k, with $48k in IRMAA surcharges (15% of total).",
    "The household spends 8 of 25 Medicare years in an IRMAA tier.",
  ],
};

describe("MedicareSummaryView", () => {
  it("renders a populated fixture", () => {
    const { container } = render(<MedicareSummaryView data={POPULATED} />);
    expect(container.textContent).toContain("Medicare & IRMAA Summary");
    expect(container.textContent).toContain("15%");
    expect(container.textContent).toContain("IRMAA tier exposure");
    expect(container.textContent).toContain("Tier 2");
    expect(container.textContent).toContain("Enrollment");
  });

  it("renders the empty state", () => {
    const data = { isEmpty: true, title: "Medicare & IRMAA Summary", subtitle: "" } as never;
    const { getByText } = render(<MedicareSummaryView data={data} />);
    expect(getByText("No data for this scenario yet.")).toBeTruthy();
  });
});
