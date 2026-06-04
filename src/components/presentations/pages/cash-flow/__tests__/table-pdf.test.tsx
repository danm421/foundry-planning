import { describe, it, expect } from "vitest";
import { Document, Page, renderToBuffer } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { AccentProvider } from "@/components/presentations/shared/accent-context";
import { CashflowTablePdf } from "../table-pdf";
import { SECTION_ACCENTS } from "@/lib/presentations/theme";
import type { CashFlowPageData } from "@/lib/presentations/types";

ensureFontsRegistered();

const data: CashFlowPageData = {
  title: "Cash Flow",
  subtitle: "Base Case",
  chartSpec: {
    kind: "stackedBarWithLine",
    width: 500,
    height: 200,
    margin: { top: 10, right: 10, bottom: 10, left: 10 },
    xAxis: { domain: [2026, 2027], ticks: [2026, 2027], labelFormat: (v) => String(v) },
    yAxis: { domain: [0, 1], ticks: [0, 1], labelFormat: (v) => String(v), gridlineColor: "#eeeeee" },
    stacks: [],
    lines: [],
    markers: [],
    legend: { position: "bottom", items: [] },
  },
  table: {
    rows: [
      {
        year: 2026, ageClient: 60, ageSpouse: 58,
        cells: {
          salary: 120000, socialSecurity: 0, otherInflows: 0, rmds: 0, withdrawals: 0,
          totalIncome: 120000, expenses: 80000, savings: 10000, totalExpenses: 90000,
          netCashFlow: 30000, portfolioGrowth: 5000, portfolioActivity: 0, portfolioAssets: 500000,
        },
      },
      {
        year: 2027, ageClient: 61, ageSpouse: 59,
        cells: {
          salary: 124000, socialSecurity: 0, otherInflows: 0, rmds: 0, withdrawals: 0,
          totalIncome: 124000, expenses: 82000, savings: 10000, totalExpenses: 92000,
          netCashFlow: 32000, portfolioGrowth: 5200, portfolioActivity: 0, portfolioAssets: 530000,
        },
      },
    ],
    markers: [{ year: 2027, kind: "retirement", who: "client", label: "Retire" }],
  },
  footnote: "Test",
};

describe("CashflowTablePdf", () => {
  it("renders the cash flow table under a section accent", async () => {
    const buf = await renderToBuffer(
      <Document>
        <Page>
          <AccentProvider accent={SECTION_ACCENTS["Cash Flow"]}>
            <CashflowTablePdf data={data} />
          </AccentProvider>
        </Page>
      </Document>,
    );
    expect(buf.length).toBeGreaterThan(0);
  });
});
