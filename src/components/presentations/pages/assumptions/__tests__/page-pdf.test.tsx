import { describe, it, expect } from "vitest";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { AssumptionsPagePdf } from "../page-pdf";
import type { AssumptionsPageData } from "@/lib/presentations/pages/assumptions/types";
import { DEFAULT_ACCENT } from "@/lib/presentations/theme";

const FULL: AssumptionsPageData = {
  title: "Planning Assumptions",
  subtitle: "Base Case",
  overviewSections: [
    { heading: "Plan Horizon", rows: [{ label: "Plan start", value: "2026" }, { label: "Length", value: "30 years" }] },
    { heading: "Income Tax", rows: [{ label: "Method", value: "Flat rate" }, { label: "Federal rate", value: "22.0%" }] },
    { heading: "Estate Tax", rows: [{ label: "Admin expenses", value: "$20,000" }] },
    { heading: "Inflation", rows: [{ label: "General inflation", value: "3.0%" }] },
  ],
  categoryGrowth: [
    { category: "Taxable", source: "Model: 60/40 Growth", rate: "6.2%" },
    { category: "Cash", source: "Inflation", rate: "3.0%" },
  ],
  withdrawalOrder: ["Checking", "Joint Brokerage"],
  stressTests: [{ label: "Market shock", value: "30.0% drawdown in 2030" }],
  accounts: [
    { name: "Joint Brokerage", category: "Taxable", value: 500000, rate: "6.2%", source: "Model: 60/40 Growth" },
    { name: "Checking", category: "Cash", value: 25000, rate: "2.0%", source: "Inflation" },
  ],
  referencedPortfolios: [
    { name: "60/40 Growth", blendedReturn: "6.2%", rows: [{ assetClass: "US Equity", weight: "60.0%", classReturn: "8.0%" }] },
  ],
  cma: [{ assetClass: "US Equity", expectedReturn: "8.0%", volatility: "16.0%" }],
  showBaseCaseFootnote: true,
};

const MINIMAL: AssumptionsPageData = {
  ...FULL,
  categoryGrowth: [],
  stressTests: [],
  accounts: null,
  referencedPortfolios: null,
  cma: null,
  showBaseCaseFootnote: false,
};

describe("AssumptionsPagePdf", () => {
  it("renders the full report without throwing", async () => {
    ensureFontsRegistered();
    const buf = await renderToBuffer(
      <Document>
        <AssumptionsPagePdf data={FULL} firmName="Foundry Planning" clientName="John & Jane Smith" reportDate="July 2, 2026" pageIndex={0} totalPages={3} accent={DEFAULT_ACCENT} />
      </Document>,
    );
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("renders the overview-only report without throwing", async () => {
    ensureFontsRegistered();
    const buf = await renderToBuffer(
      <Document>
        <AssumptionsPagePdf data={MINIMAL} firmName="Foundry" clientName="John Smith" reportDate="July 2, 2026" pageIndex={0} totalPages={1} accent={DEFAULT_ACCENT} />
      </Document>,
    );
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});
