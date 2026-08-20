import { describe, it, expect } from "vitest";
import { earlyYearsTidbitsOptionsSchema } from "../options-schema";
import { EARLY_YEARS_TIDBITS_OPTIONS_DEFAULT, TIDBITS_PAGE_MAX } from "../types";
import { summarizeEarlyYearsTidbitsOptions } from "../summarize-options";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);

describe("earlyYearsTidbitsOptionsSchema", () => {
  it("accepts the page's own defaults", () => {
    expect(() => earlyYearsTidbitsOptionsSchema.parse(EARLY_YEARS_TIDBITS_OPTIONS_DEFAULT))
      .not.toThrow();
  });

  it("fills in an absent list rather than parsing to undefined", () => {
    // The export route passes RAW options to the ref hooks while `document.tsx`
    // passes `{...defaultOptions, ...options}`. A field that is undefined on one
    // side and `[]` on the other makes the two disagree about the same page.
    expect(earlyYearsTidbitsOptionsSchema.parse({})).toEqual({ tidbits: [] });
  });

  it("takes the full cap", () => {
    expect(
      earlyYearsTidbitsOptionsSchema.parse({ tidbits: ids(TIDBITS_PAGE_MAX) }).tidbits,
    ).toHaveLength(TIDBITS_PAGE_MAX);
  });

  it("refuses one past the cap — the cap is what keeps this page on one sheet", () => {
    // The picker caps the advisor at six, but a saved template descriptor or an
    // API caller reaches this schema directly. `render-smoke.test.tsx` measures
    // six at the copy cap against real PDF geometry; a seventh is unmeasured.
    expect(() => earlyYearsTidbitsOptionsSchema.parse({ tidbits: ids(TIDBITS_PAGE_MAX + 1) })).toThrow();
  });
});

describe("summarizeEarlyYearsTidbitsOptions", () => {
  it("says what the advisor picked, singular and plural", () => {
    expect(summarizeEarlyYearsTidbitsOptions({ tidbits: [] })).toBe("no tidbits");
    expect(summarizeEarlyYearsTidbitsOptions({ tidbits: ids(1) })).toBe("1 tidbit");
    expect(summarizeEarlyYearsTidbitsOptions({ tidbits: ids(6) })).toBe("6 tidbits");
  });
});
