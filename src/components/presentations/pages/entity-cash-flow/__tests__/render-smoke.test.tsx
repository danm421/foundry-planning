import { describe, it, expect } from "vitest";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { SECTION_ACCENTS } from "@/lib/presentations/theme";
import type { TrustCashFlowRow, BusinessCashFlowRow } from "@/engine/types";
import { EntityCashFlowPagePdf } from "../page-pdf";
import type { EntityCashFlowPageData } from "../types";

const trustRow: TrustCashFlowRow = {
  kind: "trust", entityId: "t1", entityName: "Smith Family Trust", year: 2026, ages: { client: 60 },
  trustSubType: "irrevocable", isGrantor: false, beginningBalance: 1_000_000, transfersIn: 0,
  growth: 50_000, income: 20_000, totalDistributions: 10_000, expenses: 5_000, taxes: 3_000, endingBalance: 1_052_000,
};
const businessRow: BusinessCashFlowRow = {
  kind: "business", entityId: "b1", entityName: "ABC Holdings LLC", year: 2026, ages: { client: 60 },
  entityType: "llc", beginningTotalValue: 2_000_000, beginningBasis: 500_000, growth: 100_000, income: 80_000,
  expenses: 20_000, annualDistribution: 40_000, retainedEarnings: 20_000, endingTotalValue: 2_120_000, endingBasis: 500_000,
};

const base = { firmName: "Acme Advisors", clientName: "Smith", reportDate: "June 8, 2026", pageIndex: 1, totalPages: 1, accent: SECTION_ACCENTS["Cash Flow"] };

async function renderData(data: EntityCashFlowPageData) {
  ensureFontsRegistered();
  return renderToBuffer(<Document>{EntityCashFlowPagePdf({ data, ...base })}</Document>);
}

describe("EntityCashFlowPagePdf render", () => {
  it("renders a trust to a non-trivial PDF buffer", async () => {
    const buf = await renderData({ title: "Business & Trusts — Smith Family Trust", subtitle: "Base Case", selected: { kind: "trust", rows: [trustRow] } });
    expect(buf.byteLength).toBeGreaterThan(1000);
  });

  it("renders a business without throwing", async () => {
    const buf = await renderData({ title: "Business & Trusts — ABC Holdings LLC", subtitle: "Base Case", selected: { kind: "business", rows: [businessRow] } });
    expect(buf.byteLength).toBeGreaterThan(1000);
  });

  it("renders the empty state without throwing", async () => {
    const buf = await renderData({ title: "Business & Trusts", subtitle: "Base Case", selected: { kind: "empty", rows: [] } });
    expect(buf.byteLength).toBeGreaterThan(1000);
  });
});
