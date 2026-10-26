import { describe, it, expect } from "vitest";
import { runProjection } from "@/engine/projection";
import { buildClientData } from "@/engine/__tests__/fixtures";
import type { BuildDataContext } from "@/components/presentations/registry";
import { buildBalanceSheetReportProps } from "@/lib/balance-sheet/build-report-props";
import { buildBalanceSheetPdfView } from "@/lib/balance-sheet/pdf-view";
import { buildBalanceSheetReportPageData } from "../view-model";
import {
  BALANCE_SHEET_REPORT_OPTIONS_DEFAULT,
  balanceSheetReportOptionsSchema,
  summarizeBalanceSheetReportOptions,
} from "../options-schema";

const clientData = buildClientData({ client: { ...buildClientData().client, spouseName: "Jane" } });
const years = runProjection(clientData);
const ctx = { clientData, years } as BuildDataContext;
const thisYear = new Date().getFullYear();

describe("buildBalanceSheetReportPageData", () => {
  it("prints the Assets report's household sheet: the pie and the owner columns", () => {
    const data = buildBalanceSheetReportPageData(ctx, BALANCE_SHEET_REPORT_OPTIONS_DEFAULT);
    if (data.view.kind !== "household") throw new Error("expected the household view");

    expect(data.view.clientLabel).toBe("John");
    expect(data.view.spouseLabel).toBe("Jane");
    expect(data.view.household.assetCategories.length).toBeGreaterThan(0);
    expect(data.view.donut.length).toBeGreaterThan(0);
    expect(data.subtitle).toBe(`Household · Today (${thisYear}) · Ages ${years[0].ages.client} & ${years[0].ages.spouse}`);
  });

  it("is the sheet the Assets tab's Download PDF prints for the same selection", () => {
    const options = { asOf: "eoy" as const, year: 2030, view: "household" as const };
    const report = buildBalanceSheetReportProps(clientData, years, { clientLabel: "John", spouseName: "Jane" });
    expect(buildBalanceSheetReportPageData(ctx, options)).toEqual(
      buildBalanceSheetPdfView(report, { tab: "household", filter: "all", selectedYear: 2030, asOfMode: "eoy" }),
    );
  });

  it("clamps a year outside the plan to its last year", () => {
    const last = years[years.length - 1].year;
    const data = buildBalanceSheetReportPageData(ctx, { asOf: "eoy", year: 2999, view: "household" });
    expect(data.subtitle.startsWith(`Household · End of ${last}`)).toBe(true);
  });

  it("prints the By Entity sheet when asked", () => {
    const data = buildBalanceSheetReportPageData(ctx, { ...BALANCE_SHEET_REPORT_OPTIONS_DEFAULT, view: "entities" });
    expect(data.view.kind).toBe("entities");
    expect(data.subtitle.startsWith("By Entity · Today")).toBe(true);
  });
});

describe("balanceSheetReportOptionsSchema", () => {
  it("round-trips a saved template's options", () => {
    const saved = { asOf: "eoy" as const, year: 2035, view: "entities" as const };
    expect(balanceSheetReportOptionsSchema.parse(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });

  it("opens on the household view", () => {
    expect(balanceSheetReportOptionsSchema.parse({ asOf: "today", year: 2026 }).view).toBe("household");
  });

  it("names the view and the date in the launcher", () => {
    expect(summarizeBalanceSheetReportOptions({ asOf: "today", year: 2026, view: "household" })).toBe("Household · As of today");
    expect(summarizeBalanceSheetReportOptions({ asOf: "eoy", year: 2031, view: "entities" })).toBe("By Entity · End of 2031");
  });
});
