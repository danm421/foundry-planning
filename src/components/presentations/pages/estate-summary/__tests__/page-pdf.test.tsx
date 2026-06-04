import { describe, it, expect } from "vitest";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { EstateSummaryPagePdf } from "../page-pdf";
import type { EstateSummaryPageData, EstateSummaryChartBar } from "@/lib/presentations/pages/estate-summary/view-model";
import type { EstateSummaryDeathRow } from "@/lib/presentations/pages/estate-summary/aggregate";
import type { EstateSummaryHeirRow } from "@/lib/presentations/pages/estate-summary/heirs";
import { DEFAULT_ACCENT } from "@/lib/presentations/theme";

ensureFontsRegistered();

const framing = {
  firmName: "Foundry",
  clientName: "Cooper Sample",
  reportDate: "June 1, 2026",
  pageIndex: 1,
  totalPages: 1,
  accent: DEFAULT_ACCENT,
};

const chartBars: EstateSummaryChartBar[] = [
  {
    label: "Today",
    netToHeirs: 2_800_000,
    federal: 400_000,
    state: 100_000,
    probate: 50_000,
    ird: 30_000,
    debts: 120_000,
    total: 3_500_000,
  },
  {
    label: "End of Life",
    netToHeirs: 4_200_000,
    federal: 900_000,
    state: 200_000,
    probate: 80_000,
    ird: 50_000,
    debts: 200_000,
    total: 5_630_000,
  },
];

const todayRows: EstateSummaryDeathRow[] = [
  {
    label: "First death",
    decedentName: "Tom Cooper",
    deathOrder: 1,
    year: 2026,
    grossEstate: 2_000_000,
    federal: 0,
    state: 0,
    probate: 20_000,
    ird: 10_000,
    netAfterTax: 1_970_000,
  },
  {
    label: "Second death",
    decedentName: "Linda Cooper",
    deathOrder: 2,
    year: 2026,
    grossEstate: 1_700_000,
    federal: 400_000,
    state: 100_000,
    probate: 30_000,
    ird: 20_000,
    netAfterTax: 1_150_000,
  },
];

const eolRows: EstateSummaryDeathRow[] = [
  {
    label: "First death",
    decedentName: "Tom Cooper",
    deathOrder: 1,
    year: 2041,
    grossEstate: 3_200_000,
    federal: 0,
    state: 0,
    probate: 32_000,
    ird: 18_000,
    netAfterTax: 3_150_000,
  },
  {
    label: "Second death",
    decedentName: "Linda Cooper",
    deathOrder: 2,
    year: 2046,
    grossEstate: 2_800_000,
    federal: 900_000,
    state: 200_000,
    probate: 48_000,
    ird: 32_000,
    netAfterTax: 1_620_000,
  },
];

const heirs: EstateSummaryHeirRow[] = [
  {
    key: "child|casey",
    recipientLabel: "Casey Cooper",
    todayOutright: 900_000,
    todayInTrust: 500_000,
    todayTotal: 1_400_000,
    eolOutright: 1_500_000,
    eolInTrust: 800_000,
    eolTotal: 2_300_000,
  },
  {
    key: "child|alex",
    recipientLabel: "Alex Cooper",
    todayOutright: 800_000,
    todayInTrust: 600_000,
    todayTotal: 1_400_000,
    eolOutright: 1_200_000,
    eolInTrust: 700_000,
    eolTotal: 1_900_000,
  },
];

const populatedData: EstateSummaryPageData = {
  title: "Estate Summary",
  subtitle: "Base Case · As of 2026 vs. End of Life",
  isMarried: true,
  isEmpty: false,
  kpis: {
    grossEstateToday: 3_500_000,
    grossEstateEol: 5_630_000,
    taxAndCostsToday: 580_000,
    taxAndCostsEol: 1_230_000,
    netToHeirsToday: 2_800_000,
    netToHeirsEol: 4_200_000,
    shrinkageToday: 0.166,
    shrinkageEol: 0.218,
  },
  chart: chartBars,
  todayRows,
  eolRows,
  heirs,
  narrative: [
    "At the current estate value of $3.5M, estate taxes and transfer costs consume roughly 17% of the gross estate.",
    "By end of life the gross estate grows to an estimated $5.6M, pushing shrinkage to 22% as the federal exemption phases down.",
    "Structured trust distributions could reduce the taxable estate and increase net inheritance for Casey and Alex.",
  ],
};

const emptyData: EstateSummaryPageData = {
  title: "Estate Summary",
  subtitle: "Base Case · As of 2026 vs. End of Life",
  isMarried: false,
  isEmpty: true,
  kpis: {
    grossEstateToday: 0,
    grossEstateEol: 0,
    taxAndCostsToday: 0,
    taxAndCostsEol: 0,
    netToHeirsToday: 0,
    netToHeirsEol: 0,
    shrinkageToday: 0,
    shrinkageEol: 0,
  },
  chart: [],
  todayRows: [],
  eolRows: [],
  heirs: [],
  narrative: [],
};

describe("EstateSummaryPagePdf render smoke", () => {
  it("renders populated fixture (kpis, chart, tables, heirs, narrative)", async () => {
    const buf = await renderToBuffer(
      <Document>{EstateSummaryPagePdf({ data: populatedData, ...framing })}</Document>,
    );
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("renders empty fixture (isEmpty: true)", async () => {
    const buf = await renderToBuffer(
      <Document>{EstateSummaryPagePdf({ data: emptyData, ...framing })}</Document>,
    );
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});
