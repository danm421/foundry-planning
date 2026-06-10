// src/components/presentations/pages/retirement-comparison/render-smoke.test.tsx
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { SECTION_ACCENTS } from "@/lib/presentations/theme";
import { RetirementComparisonPagePdf } from "./page-pdf";
import type {
  RetirementComparisonPageData,
  OverlayBar,
  ConfidencePoint,
  MaxSpendPoint,
} from "@/lib/presentations/pages/retirement-comparison/types";

// Cooper-representative synthetic series so the rendered preview matches the
// shape of a real report (45-year projection, retirement at 2037).
const overlay: OverlayBar[] = Array.from({ length: 45 }, (_, i) => {
  const year = 2026 + i;
  const base = 1_000_000 * Math.pow(1.04, i);
  const scn = 1_000_000 * Math.pow(1.082, i);
  return { year, floor: Math.min(base, scn), scenarioAhead: Math.max(0, scn - base), baseAhead: Math.max(0, base - scn) };
});

const maxSpendSeries: MaxSpendPoint[] = Array.from({ length: 34 }, (_, i) => {
  const year = 2037 + i;
  const f = Math.pow(1.02, year - 2026);
  return { year, base: Math.round(92_000 * f), scenario: Math.round(214_000 * f) };
});

const confidence: ConfidencePoint[] = Array.from({ length: 34 }, (_, i) => {
  const year = 2037 + i;
  const bMid = 4_000_000 * Math.pow(1.03, i);
  const sMid = 6_000_000 * Math.pow(1.05, i);
  return {
    year,
    baseP20: bMid * 0.14, baseP50: bMid, baseP80: bMid * 1.7,
    scnP20: sMid * 0.46, scnP50: sMid, scnP80: sMid * 1.6,
  };
});

const data: RetirementComparisonPageData = {
  title: "Retirement Comparison",
  subtitle: "Base Case vs. New Plan",
  isEmpty: false,
  verdict: { headline: "99% chance your plan fully funds your life — up from 83%." },
  kpis: [
    { label: "Probability of success", base: "83%", scenario: "99%", delta: "+16 pts", show: true },
    { label: "Legacy to heirs", base: "$10.8M", scenario: "$34.4M", delta: "+$23.6M", show: true },
    { label: "Max sustainable spend", base: "$92K/yr", scenario: "$214K/yr", delta: "+$122K/yr", show: true },
    { label: "Downside ending balance", base: "$1.5M", scenario: "$13.9M", delta: "+$12.4M", show: true },
  ],
  overlay,
  atRetirement: {
    year: 2037,
    base: { cash: 352_000, taxable: 1_700_000, preTax: 2_050_000, roth: 100_000, hsa: 50_000 },
    scenario: { cash: 683_000, taxable: 3_500_000, preTax: 1_600_000, roth: 600_000, hsa: 80_000 },
  },
  atEndOfLife: {
    year: 2070,
    base: { cash: 736_000, taxable: 5_700_000, preTax: 4_200_000, roth: 150_000, hsa: 0 },
    scenario: { cash: 29_000, taxable: 20_400_000, preTax: 12_000_000, roth: 1_900_000, hsa: 0 },
  },
  maxSpend: { show: true, baseToday: 92_000, scenarioToday: 214_000, series: maxSpendSeries },
  confidence: { show: true, points: confidence },
  showPortfolioMatrix: true,
  showAiSummary: true,
  aiMarkdown:
    "Your New Plan is meaningfully stronger: the probability of success rises from 83% to 99%, and total portfolio assets grow from $4.2M to $6.5M by retirement and from $10.8M to $34.4M by the end of life. The downside picture improves too, with the poor-market ending balance moving from $1.5M to $13.9M, and the plan can support much higher retirement spending at the same confidence level — $214K versus $92K. That improvement reflects several changes working together: delaying retirement to 67 adds earning and compounding years, while the added business cash, real estate changes, asset sales, and more aggressive reinvestment increase the capital working for you. The Roth contributions and Roth conversion shift some tax cost earlier — lifetime taxes rise from $3.7M to $4.0M — but in return create more tax-free growth and flexibility later, helping support the larger ending balances.",
};

describe("RetirementComparisonPagePdf render", () => {
  it("renders to a non-trivial PDF buffer", async () => {
    ensureFontsRegistered();
    const buf = await renderToBuffer(
      <Document>
        {RetirementComparisonPagePdf({
          data, firmName: "Ethos Financial Group", clientName: "Cooper Sample", reportDate: "June 10, 2026",
          pageIndex: 1, totalPages: 2, accent: SECTION_ACCENTS.Comparison,
        })}
      </Document>,
    );
    expect(buf.byteLength).toBeGreaterThan(1000);
    if (process.env.EMIT_PDF) writeFileSync(process.env.EMIT_PDF, buf);
  });

  it("renders the empty state without throwing", async () => {
    ensureFontsRegistered();
    const buf = await renderToBuffer(
      <Document>
        {RetirementComparisonPagePdf({
          data: { ...data, isEmpty: true },
          firmName: "Ethos", clientName: "Cooper Sample", reportDate: "June 10, 2026",
          pageIndex: 1, totalPages: 2, accent: SECTION_ACCENTS.Comparison,
        })}
      </Document>,
    );
    expect(buf.byteLength).toBeGreaterThan(500);
  });
});
