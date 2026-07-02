import { describe, it, expect } from "vitest";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { HoldingsPagePdf } from "../page-pdf";
import type { HoldingsPageData } from "@/lib/presentations/pages/holdings/types";
import { SECTION_ACCENTS } from "@/lib/presentations/theme";

const ACCENT = SECTION_ACCENTS.Assets;

const ROW = {
  ticker: "VTI",
  name: "Vanguard Total Stock Market ETF",
  shares: "400",
  price: "$250.00",
  marketValue: "$100,000",
  pctOfTotal: "50.0%",
  costBasis: "$80,000",
  gainLoss: { text: "+$20,000 (+25.0%)", tone: "good" as const },
};
const NULL_CB_ROW = { ...ROW, ticker: "", name: "Private Fund LP", costBasis: null, gainLoss: null };

const GROUPED: HoldingsPageData = {
  title: "Holdings",
  subtitle: "As of July 2, 2026",
  totalValue: "$200,000",
  accountCount: 2,
  positionCount: 3,
  includeCostBasis: true,
  accountBlocks: [
    { accountName: "Joint Brokerage", category: "taxable", totalValue: "$150,000", pctOfTotal: "75.0%", rows: [ROW, NULL_CB_ROW] },
    { accountName: "Roth IRA", category: "retirement", totalValue: "$50,000", pctOfTotal: "25.0%", rows: [{ ...ROW, ticker: "BND", gainLoss: { text: "-$5,000 (-9.1%)", tone: "crit" as const } }] },
  ],
  flatRows: null,
};

const FLAT: HoldingsPageData = {
  ...GROUPED,
  includeCostBasis: false,
  accountBlocks: null,
  flatRows: [
    { ...ROW, accountName: "Joint Brokerage" },
    { ...NULL_CB_ROW, accountName: "Joint Brokerage" },
  ],
};

const EMPTY: HoldingsPageData = {
  ...GROUPED,
  totalValue: "$0",
  accountCount: 0,
  positionCount: 0,
  accountBlocks: [],
};

const frame = {
  firmName: "Foundry Planning",
  clientName: "John & Jane Smith",
  reportDate: "July 2, 2026",
  pageIndex: 0,
  totalPages: 1,
  accent: ACCENT,
};

describe("HoldingsPagePdf", () => {
  it("renders grouped mode with cost basis without throwing", async () => {
    ensureFontsRegistered();
    const buf = await renderToBuffer(
      <Document><HoldingsPagePdf data={GROUPED} {...frame} /></Document>,
    );
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("renders flat mode without cost basis without throwing", async () => {
    ensureFontsRegistered();
    const buf = await renderToBuffer(
      <Document><HoldingsPagePdf data={FLAT} {...frame} /></Document>,
    );
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("renders the empty state without throwing", async () => {
    ensureFontsRegistered();
    const buf = await renderToBuffer(
      <Document><HoldingsPagePdf data={EMPTY} {...frame} /></Document>,
    );
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});
