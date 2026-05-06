// src/components/reports-pdf/widgets/widgets.test.tsx
//
// Snapshot coverage of the polished PDF widget renders introduced in
// Phase 4b of the ethos-style-reports redesign. We don't rasterize the
// PDF — that's an integration concern. We just snapshot the React
// element tree each render returns so future shape/style changes are
// reviewable in PR diffs.
//
// Covers:
//   - kpiTile (with each accentColor variant + delta)
//   - balanceSheetTable (populated + empty)
//   - cashflowTable (with totals row)
//   - advisorCommentary (headline + body + notes)
//   - aiAnalysis (paragraphs + bullet list)

import { describe, it, expect } from "vitest";
import "@/lib/reports/metrics"; // side-effect: registers `netWorthNow` etc.

import { KpiTilePdfRender } from "./kpi-tile";
import { BalanceSheetTablePdfRender } from "./balance-sheet-table";
import { CashflowTablePdfRender } from "./cashflow-table";
import { AdvisorCommentaryPdfRender } from "./advisor-commentary";
import { AiAnalysisPdfRender } from "./ai-analysis";
import type { BalanceSheetViewModel } from "@/components/balance-sheet-report/view-model";
import type { CashflowScopeData } from "@/lib/reports/scopes/cashflow";

describe("kpiTile PDF render", () => {
  it("renders default accent + delta", () => {
    const el = KpiTilePdfRender({
      props: {
        metricKey: "netWorthNow",
        showDelta: true,
        subtitle: "Up vs prior year",
      },
      data: { value: 1_250_000, prevValue: 1_100_000 },
      mode: "pdf",
      widgetId: "w1",
    });
    expect(el).toMatchSnapshot();
  });

  it("renders good accent variant", () => {
    const el = KpiTilePdfRender({
      props: { metricKey: "netWorthNow", accentColor: "good" },
      data: { value: 1_250_000 },
      mode: "pdf",
      widgetId: "w1",
    });
    expect(el).toMatchSnapshot();
  });

  it("renders crit accent variant with negative delta", () => {
    const el = KpiTilePdfRender({
      props: {
        metricKey: "netWorthNow",
        accentColor: "crit",
        showDelta: true,
      },
      data: { value: 800_000, prevValue: 900_000 },
      mode: "pdf",
      widgetId: "w1",
    });
    expect(el).toMatchSnapshot();
  });

  it("renders steel accent with title override", () => {
    const el = KpiTilePdfRender({
      props: {
        metricKey: "netWorthNow",
        accentColor: "steel",
        titleOverride: "Estate value",
      },
      data: { value: 2_000_000 },
      mode: "pdf",
      widgetId: "w1",
    });
    expect(el).toMatchSnapshot();
  });
});

describe("balanceSheetTable PDF render", () => {
  const vm: BalanceSheetViewModel = {
    selectedYear: 2026,
    assetCategories: [
      { key: "cash", label: "Cash", total: 50_000, rows: [], yoy: null },
      { key: "taxable", label: "Taxable", total: 250_000, rows: [], yoy: null },
      { key: "retirement", label: "Retirement", total: 700_000, rows: [], yoy: null },
    ],
    outOfEstateRows: [],
    outOfEstateLiabilityRows: [],
    outOfEstateNetWorth: 0,
    liabilityRows: [],
    totalAssets: 1_000_000,
    totalLiabilities: 200_000,
    netWorth: 800_000,
    realEstateEquity: 0,
    donut: [],
    barChartSeries: [],
    yoy: { totalAssets: null, totalLiabilities: null, netWorth: null },
  };

  it("renders populated", () => {
    const el = BalanceSheetTablePdfRender({
      props: {
        title: "Balance sheet",
        subtitle: "As of Jan 1, 2026",
        asOfYear: 2026,
        ownership: "consolidated",
        showEntityBreakdown: false,
      },
      data: vm,
      mode: "pdf",
      widgetId: "w2",
    });
    expect(el).toMatchSnapshot();
  });

  it("renders negative net-worth in crit color", () => {
    const el = BalanceSheetTablePdfRender({
      props: {
        title: "Balance sheet",
        asOfYear: 2026,
        ownership: "consolidated",
        showEntityBreakdown: false,
      },
      data: { ...vm, totalAssets: 100_000, totalLiabilities: 200_000, netWorth: -100_000 },
      mode: "pdf",
      widgetId: "w2",
    });
    expect(el).toMatchSnapshot();
  });

  it("renders empty state when data missing", () => {
    const el = BalanceSheetTablePdfRender({
      props: {
        title: "Balance sheet",
        asOfYear: 2026,
        ownership: "consolidated",
        showEntityBreakdown: false,
      },
      data: undefined,
      mode: "pdf",
      widgetId: "w2",
    });
    expect(el).toMatchSnapshot();
  });
});

describe("cashflowTable PDF render", () => {
  const cashflow: CashflowScopeData = {
    years: [
      {
        year: 2026,
        incomeWages: 200_000,
        incomeSocialSecurity: 0,
        incomePensions: 0,
        incomeWithdrawals: 0,
        incomeOther: 0,
        expenses: 120_000,
        savings: 50_000,
        net: 30_000,
      },
      {
        year: 2027,
        incomeWages: 100_000,
        incomeSocialSecurity: 30_000,
        incomePensions: 0,
        incomeWithdrawals: 50_000,
        incomeOther: 0,
        expenses: 200_000,
        savings: 0,
        net: -20_000,
      },
    ],
  };

  it("renders with totals", () => {
    const el = CashflowTablePdfRender({
      props: {
        title: "Cashflow detail",
        subtitle: "2026–2027",
        yearRange: { from: 2026, to: 2027 },
        ownership: "consolidated",
        showTotals: true,
      },
      data: { cashflow },
      mode: "pdf",
      widgetId: "w3",
    });
    expect(el).toMatchSnapshot();
  });

  it("renders without totals", () => {
    const el = CashflowTablePdfRender({
      props: {
        title: "Cashflow detail",
        yearRange: { from: 2026, to: 2027 },
        ownership: "consolidated",
        showTotals: false,
      },
      data: { cashflow },
      mode: "pdf",
      widgetId: "w3",
    });
    expect(el).toMatchSnapshot();
  });
});

describe("advisorCommentary PDF render", () => {
  it("renders headline + body + notes", () => {
    const el = AdvisorCommentaryPdfRender({
      props: {
        headline: "Strong foundation, watch concentration",
        body:
          "Your liquid net worth comfortably covers near-term obligations.\n\n" +
          "We recommend rebalancing the taxable account to reduce single-stock concentration.",
        notes: "Reviewed 2026-05-06.",
      },
      data: null,
      mode: "pdf",
      widgetId: "w4",
    });
    expect(el).toMatchSnapshot();
  });

  it("renders body only", () => {
    const el = AdvisorCommentaryPdfRender({
      props: { body: "Quick note for the client." },
      data: null,
      mode: "pdf",
      widgetId: "w4",
    });
    expect(el).toMatchSnapshot();
  });
});

describe("aiAnalysis PDF render", () => {
  it("renders paragraphs and bullet list", () => {
    const el = AiAnalysisPdfRender({
      props: {
        title: "Cashflow analysis",
        scopes: ["cashflow"],
        tone: "concise",
        length: "short",
        body:
          "Income comfortably exceeds expenses through 2030.\n\n" +
          "Key risks:\n- Concentration in employer stock\n- Health-care inflation",
        notes: "Generated 2026-05-06 with concise tone.",
      },
      data: null,
      mode: "pdf",
      widgetId: "w5",
    });
    expect(el).toMatchSnapshot();
  });
});
