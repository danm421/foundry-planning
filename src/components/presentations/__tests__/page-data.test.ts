import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProjectionResult } from "@/engine";
import type { CashFlowPageData } from "@/lib/presentations/types";
import {
  makeClientData,
  makeProjectionYears,
} from "@/lib/presentations/pages/cash-flow/__tests__/fixtures";

// The export's IO is replaced: these tests are about which page data comes out,
// not about loading it. document.tsx and the registry stay real.
const prepare = vi.hoisted(() => vi.fn());
vi.mock("../render-presentation-pdf", () => ({ preparePresentation: prepare }));

import { buildPresentationEntries, type PresentationDocumentProps } from "../document";
import { buildReportPageData, stripBinary } from "../page-data";
import type { ExportPdfBody } from "../render-presentation-pdf";

/**
 * One page on the "Retire at 62" scenario, in a deck whose own scenario is a
 * decoy base case holding only the first projection year — so data read from
 * the wrong bundle shows up as the wrong label and the wrong years.
 */
function props(pageId: "cover" | "cashFlow"): PresentationDocumentProps {
  const years = makeProjectionYears();
  return {
    pages: [{ pageId, options: undefined, scenarioKey: "retire62" }],
    firmName: "Foundry Planning",
    firmTagline: null,
    firmLogoDataUrl: "data:image/png;base64,AAAA",
    accentColor: "#b87f1f",
    clientName: "Cooper Sample",
    reportDate: "May 28, 2026",
    spouseName: "Susan",
    spouseLastName: "Sample",
    headerName: "Cooper & Susan",
    bundles: {
      base: {
        clientData: makeClientData(),
        projection: { years: years.slice(0, 1) } as unknown as ProjectionResult,
        scenarioLabel: "Base Case",
      },
      retire62: {
        clientData: makeClientData(),
        projection: { years } as unknown as ProjectionResult,
        scenarioLabel: "Retire at 62",
      },
    },
    topScenarioKey: "base",
  };
}

const prepared = (pageId: "cover" | "cashFlow") => ({
  props: props(pageId),
  filename: "x.pdf",
  clientLastName: "Sample",
  distinctScenarioCount: 2,
});

const body = { scenarioId: null, preview: false, pages: [] } as unknown as ExportPdfBody;

beforeEach(() => {
  prepare.mockReset();
});

describe("buildPresentationEntries", () => {
  it("builds each printed page's data and sheet count, as the document renders them", () => {
    const [entry] = buildPresentationEntries(props("cashFlow"));
    expect(entry.page.id).toBe("cashFlow");
    expect(entry.data).toBeTruthy();
    expect(entry.pageCount).toBeGreaterThan(0);
  });
});

describe("buildReportPageData", () => {
  it("returns the page's own data, built from the export's preparation, without the logo bytes", async () => {
    prepare.mockResolvedValue(prepared("cover"));
    const data = (await buildReportPageData("c1", "org_1", body)) as Record<string, unknown>;
    expect(prepare).toHaveBeenCalledWith("c1", "org_1", body);
    expect(data.clientName).toBe("Cooper Sample");
    expect(data.logoDataUrl).toBeNull();
    expect(JSON.stringify(data)).not.toContain("data:image");
  });

  it("is the cash-flow sheet's table, year by year, from the page's own scenario", async () => {
    prepare.mockResolvedValue(prepared("cashFlow"));
    const data = (await buildReportPageData("c1", "org_1", body)) as CashFlowPageData;
    const years = makeProjectionYears();

    expect(data.title).toBe("Cash Flow");
    expect(data.subtitle).toBe("Retire at 62");
    expect(data.table.rows.map((r) => r.year)).toEqual([2026, 2031, 2036, 2071]);
    expect(data.table.rows.map((r) => r.year)).toEqual(years.map((y) => y.year));
    expect(data.table.rows.map((r) => r.cells.salary)).toEqual(years.map((y) => y.income.salaries));
    expect(data.table.rows.map((r) => r.cells.netCashFlow)).toEqual(years.map((y) => y.netCashFlow));
    expect(data.table.rows[0].cells.salary).toBe(200_000);
    expect(data.table.rows[1].cells.netCashFlow).toBe(-55_000);
  });
});

describe("stripBinary", () => {
  it("drops data URLs and *DataUrl keys at any depth, and makes Maps and Sets plain JSON", () => {
    expect(
      stripBinary({
        a: "data:image/png;base64,xyz",
        nested: [{ logoDataUrl: "https://blob/x.png", keep: "ok" }],
        byYear: new Map([[2030, { v: 1 }]]),
        tags: new Set(["a"]),
        n: 3,
      }),
    ).toEqual({
      a: null,
      nested: [{ logoDataUrl: null, keep: "ok" }],
      byYear: { "2030": { v: 1 } },
      tags: ["a"],
      n: 3,
    });
  });
});
