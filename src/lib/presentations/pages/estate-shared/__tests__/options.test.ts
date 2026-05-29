import { describe, it, expect } from "vitest";
import {
  estateOptionsSchema,
  ESTATE_PAGE_OPTIONS_DEFAULT,
} from "../options-schema";
import { summarizeEstateOptions } from "../summarize-options";

describe("estate page options", () => {
  it("defaults to split as-of with heir detail on", () => {
    expect(ESTATE_PAGE_OPTIONS_DEFAULT).toEqual({
      asOf: { kind: "split" },
      showHeirDetail: true,
    });
    expect(estateOptionsSchema.parse(ESTATE_PAGE_OPTIONS_DEFAULT)).toEqual(
      ESTATE_PAGE_OPTIONS_DEFAULT,
    );
  });

  it("parses an explicit year selection", () => {
    const v = estateOptionsSchema.parse({
      asOf: { kind: "year", year: 2031 },
      showHeirDetail: false,
    });
    expect(v.asOf).toEqual({ kind: "year", year: 2031 });
  });

  it("rejects an unknown as-of kind", () => {
    expect(() =>
      estateOptionsSchema.parse({ asOf: { kind: "nope" }, showHeirDetail: true }),
    ).toThrow();
  });

  it("summarizes selections", () => {
    expect(
      summarizeEstateOptions({ asOf: { kind: "split" }, showHeirDetail: true }),
    ).toBe("Each death · Full detail");
    expect(
      summarizeEstateOptions({ asOf: { kind: "year", year: 2031 }, showHeirDetail: false }),
    ).toBe("2031 · Totals only");
  });
});
