import { describe, it, expect } from "vitest";
import { PRESENTATION_PAGES } from "../registry";
import { derivedKey } from "@/lib/presentations/derived-refs";
import { ROTH_CONVERSION_PAGE_ID } from "@/lib/presentations/pages/roth-conversion/view-model";
import type { RothConversionPageData } from "@/lib/presentations/pages/roth-conversion/types";

describe("rothConversion registration", () => {
  const page = PRESENTATION_PAGES.rothConversion;

  it("is filed under Income Tax", () => {
    expect(page.id).toBe(ROTH_CONVERSION_PAGE_ID);
    expect(page.title).toBe("Roth Conversion Strategy");
    expect(page.category).toBe("Income Tax");
    // The plan is its only option and is picked on the row, so no dialog.
    expect(page.OptionsControl).toBeUndefined();
  });

  it("defaults to Base Case and fills a missing plan with it", () => {
    expect(page.defaultOptions).toEqual({ scenarioId: "base" });
    expect(page.optionsSchema.parse({})).toEqual({ scenarioId: "base" });
  });

  it("loads the chosen plan and derives the without-conversions variant from it", () => {
    const o = { scenarioId: "s9" };
    expect(page.requiredScenarioRefs!(o)).toEqual(["s9"]);
    const [req] = page.requiredDerivedRefs!(o);
    expect(req.from).toBe("s9");
    expect(derivedKey(page.id, req.key)).toBe("derived:rothConversion:without");
  });

  it("picks the plan on the launcher row", () => {
    const set = page.planScenarioOption!.set(page.defaultOptions, "s9");
    expect(set).toEqual({ scenarioId: "s9" });
    expect(page.planScenarioOption!.get(set)).toBe("s9");
    expect(page.readBaselineScenarioId).toBeUndefined();
  });

  it("lists both sheets in the Contents, or only one for the empty state", () => {
    const full = { emptyMessage: null, schedule: [] } as unknown as RothConversionPageData;
    const empty = { emptyMessage: "This plan has no Roth conversions.", schedule: [] } as unknown as RothConversionPageData;
    expect(page.tocSections!(full, page.defaultOptions).map((t) => t.offset)).toEqual([0, 1]);
    expect(page.estimatePageCount(full, page.defaultOptions)).toBe(2);
    expect(page.tocSections!(empty, page.defaultOptions)).toHaveLength(1);
    expect(page.estimatePageCount(empty, page.defaultOptions)).toBe(1);
  });
});
