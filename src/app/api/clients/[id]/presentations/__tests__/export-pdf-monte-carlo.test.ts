import { describe, it, expect } from "vitest";
import { PRESENTATION_PAGES } from "@/components/presentations/registry";

describe("monte carlo page registration", () => {
  it("is registered under the Monte Carlo category with a highlight default", () => {
    const page = PRESENTATION_PAGES.monteCarlo;
    expect(page).toBeDefined();
    expect(page.category).toBe("Monte Carlo");
    expect(page.defaultOptions).toEqual({ highlight: "fan" });
    expect(page.supportsScenarioOverride).toBe(true);
    expect(page.estimatePageCount(undefined as never, page.defaultOptions)).toBeGreaterThanOrEqual(1);
  });

  it("renders a graceful frame when no MC payload is present", () => {
    const page = PRESENTATION_PAGES.monteCarlo;
    const data = page.buildData(
      {
        years: [], projection: {} as never, clientData: { client: { retirementAge: 65 } } as never,
        scenarioLabel: "Base Case", clientName: "X", spouseName: null, spouseLastName: null, firmName: "F",
        firmTagline: null, firmLogoDataUrl: null, accentColor: "#b87f1f",
        reportDate: "May 29, 2026", monteCarlo: null,
      },
      page.defaultOptions,
    );
    expect((data as { available: boolean }).available).toBe(false);
  });
});
