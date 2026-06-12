import { describe, it, expect } from "vitest";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { DEFAULT_ACCENT } from "@/lib/presentations/theme";
import type { MedicareSummaryPageData } from "@/lib/presentations/pages/medicare-summary/view-model";
import { MedicareSummaryPagePdf } from "../page-pdf";

ensureFontsRegistered();

const framing = {
  firmName: "Foundry",
  clientName: "Cooper Sample",
  reportDate: "June 12, 2026",
  pageIndex: 1,
  totalPages: 1,
  accent: DEFAULT_ACCENT,
};

const populated: MedicareSummaryPageData = {
  title: "Medicare & IRMAA Summary",
  subtitle: "Base Plan · Medicare years 2031–2050",
  isEmpty: false,
  kpis: { lifetimeMedicareCost: 240_000, lifetimeIrmaa: 48_000, irmaaShare: 0.2, irmaaYears: 12, enrolledYears: 20, peakTier: 3, peakTierYear: 2042 },
  bars: [
    { year: 2031, base: 4300, irmaa: 0, total: 4300, tier: 0 },
    { year: 2032, base: 8600, irmaa: 3000, total: 11_600, tier: 2 },
  ],
  composition: { partB: 90_000, partD: 24_000, medigap: 78_000, irmaa: 48_000, total: 240_000 },
  tierLadder: [
    { tier: 0, thresholdLabel: "Standard premium", years: 8 },
    { tier: 1, thresholdLabel: "≥ $206k", years: 6 },
    { tier: 2, thresholdLabel: "≥ $258k", years: 4 },
    { tier: 3, thresholdLabel: null, years: 2 },
  ],
  headroom: { year: 2034, amount: 8_000, nextTier: 2 },
  enrollment: { client: { year: 2031, age: 65 }, spouse: { year: 2033, age: 65 } },
  narrative: ["Over the plan, the household pays $240k in Medicare premiums — 20% of it ($48k) is IRMAA, the income-driven surcharge.", "IRMAA is a cliff..."],
};

describe("MedicareSummaryPagePdf", () => {
  it("renders populated data without throwing", async () => {
    const buf = await renderToBuffer(<Document>{MedicareSummaryPagePdf({ data: populated, ...framing })}</Document>);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("renders the empty state without throwing", async () => {
    const empty: MedicareSummaryPageData = { ...populated, isEmpty: true };
    const buf = await renderToBuffer(<Document>{MedicareSummaryPagePdf({ data: empty, ...framing })}</Document>);
    expect(buf.length).toBeGreaterThan(0);
  });
});
