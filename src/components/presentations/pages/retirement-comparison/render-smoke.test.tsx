// src/components/presentations/pages/retirement-comparison/render-smoke.test.tsx
import { describe, it, expect } from "vitest";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { SECTION_ACCENTS } from "@/lib/presentations/theme";
import { RetirementComparisonPagePdf } from "./page-pdf";
import type { RetirementComparisonPageData } from "@/lib/presentations/pages/retirement-comparison/types";

const data: RetirementComparisonPageData = {
  title: "Retirement Comparison",
  subtitle: "Base Case vs. Roth + Delay RE",
  isEmpty: false,
  kpis: [
    { label: "Probability of Success", base: "72%", scenario: "91%", deltaLabel: "+19 pts", direction: 1 },
    { label: "Ending Portfolio Assets", base: "$4.1M", scenario: "$5.3M", deltaLabel: "+$1.2M", direction: 1 },
    { label: "Years Fully Funded", base: "28", scenario: "34", deltaLabel: "+6", direction: 1 },
    { label: "Lifetime Taxes", base: "$1.2M", scenario: "$0.9M", deltaLabel: "−$0.3M", direction: 1 },
  ],
  overlay: [
    { year: 2026, floor: 90, scenarioAhead: 30, baseAhead: 0 },
    { year: 2027, floor: 80, scenarioAhead: 70, baseAhead: 0 },
  ],
  matrix: {
    retirementYear: 2028, endOfLifeYear: 2060,
    baseAtRetirement: { total: 4_100_000, cash: 400_000, retirement: 2_000_000, taxable: 1_700_000 },
    scenarioAtRetirement: { total: 4_300_000, cash: 420_000, retirement: 2_100_000, taxable: 1_780_000 },
    baseAtEnd: { total: 2_000_000, cash: 200_000, retirement: 900_000, taxable: 900_000 },
    scenarioAtEnd: { total: 5_300_000, cash: 500_000, retirement: 2_600_000, taxable: 2_200_000 },
  },
  changeUnits: [{ kind: "row", row: { area: "Plan & Assumptions", what: "Retirement age", op: "edit", before: "65", after: "62", why: "" } }],
  showChanges: true, showPortfolioMatrix: true, showAiSummary: true,
  aiMarkdown: "Delaying real estate and adding Roth conversions lifts your probability of success from 72% to 91%.",
};

describe("RetirementComparisonPagePdf render", () => {
  it("renders to a non-trivial PDF buffer", async () => {
    ensureFontsRegistered();
    const buf = await renderToBuffer(
      <Document>
        {RetirementComparisonPagePdf({
          data, firmName: "Acme Advisors", clientName: "Smith", reportDate: "June 4, 2026",
          pageIndex: 1, totalPages: 1, accent: SECTION_ACCENTS.Comparison,
        })}
      </Document>,
    );
    expect(buf.byteLength).toBeGreaterThan(1000);
  });

  it("renders the empty state without throwing", async () => {
    ensureFontsRegistered();
    const buf = await renderToBuffer(
      <Document>
        {RetirementComparisonPagePdf({
          data: { ...data, isEmpty: true },
          firmName: "Acme", clientName: "Smith", reportDate: "June 4, 2026",
          pageIndex: 1, totalPages: 1, accent: SECTION_ACCENTS.Comparison,
        })}
      </Document>,
    );
    expect(buf.byteLength).toBeGreaterThan(500);
  });
});
