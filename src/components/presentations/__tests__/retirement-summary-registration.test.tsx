import { describe, it, expect } from "vitest";
import { Document, renderToBuffer } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { PRESENTATION_PAGES } from "@/components/presentations/registry";
import { DEFAULT_ACCENT } from "@/lib/presentations/theme";

ensureFontsRegistered();

describe("retirementSummary registration", () => {
  const page = PRESENTATION_PAGES.retirementSummary;

  it("is registered under the Retirement category", () => {
    expect(page).toBeDefined();
    expect(page.category).toBe("Retirement");
    expect(page.estimatePageCount(undefined as never, page.defaultOptions)).toBe(2);
  });

  it("renders the empty state without throwing", async () => {
    const data = page.buildData(
      {
        years: [], projection: {} as never,
        clientData: { client: { dateOfBirth: "1966-01-01", retirementAge: 65, spouseDob: null }, clientName: "X", spouseName: null, accounts: [], incomes: [], expenses: [], planSettings: {} } as never,
        scenarioLabel: "Base", clientName: "X", spouseName: null, firmName: "F", firmTagline: null,
        reportDate: "2026-06-02", firmLogoDataUrl: null, accentColor: "#b87f1f", monteCarlo: null,
      } as never,
      page.defaultOptions,
    );
    const element = page.renderPdf({ data, firmName: "F", clientName: "X", reportDate: "2026-06-02", pageIndex: 0, totalPages: 2, accent: DEFAULT_ACCENT });
    const buf = await renderToBuffer(<Document>{element}</Document>);
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});
