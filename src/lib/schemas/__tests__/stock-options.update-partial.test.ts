/**
 * `stockOptionAccountUpdateSchema` must be PARTIAL — absent keys must stay absent.
 *
 * The worst of the six by key count: seven defaults are injected, and the PATCH
 * route writes every one of them through an `input.X !== undefined` guard that
 * an injected key always passes. A one-field rename would reset the share
 * price to 0, the withholding rate to 22%, and the whole account-level exercise
 * and sell strategy back to at-vest / hold.
 *
 * Every field here is `.optional().default(...)`, so the wrapper nests two deep
 * — the case that makes `stripDefault` a loop rather than a single unwrap.
 */
import { describe, it, expect } from "vitest";
import {
  stockOptionAccountCreateSchema,
  stockOptionAccountUpdateSchema,
} from "../stock-options";

const INJECTED_KEYS = [
  "isPublic",
  "pricePerShare",
  "autoCreateDestination",
  "sellToCover",
  "withholdingRate",
  "defaultExerciseTiming",
  "defaultSellTiming",
] as const;

describe("stockOptionAccountUpdateSchema is partial", () => {
  it("parses a one-key body to exactly that one key", () => {
    const result = stockOptionAccountUpdateSchema.safeParse({ name: "Equity — NVDA" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.keys(result.data)).toHaveLength(1);
    expect(result.data).toEqual({ name: "Equity — NVDA" });
  });

  it("injects none of the seven strategy defaults", () => {
    const result = stockOptionAccountUpdateSchema.safeParse({ ticker: "NVDA" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    for (const key of INJECTED_KEYS) {
      expect(result.data).not.toHaveProperty(key);
    }
  });

  it("parses an empty body to an empty object", () => {
    const result = stockOptionAccountUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({});
  });

  it("still round-trips an explicit strategy change", () => {
    // The percentage travels with the timing: a `percent_per_year` body with no
    // percentage is now rejected, because the engine reads a blank one as 0%
    // and never sells a share (audit F40). This test is about the PARTIAL
    // behaviour — that a two-field PATCH survives intact — so it sends a
    // complete strategy.
    const result = stockOptionAccountUpdateSchema.safeParse({
      withholdingRate: 0.37,
      defaultSellTiming: "percent_per_year",
      defaultSellPercentPerYear: 0.25,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      withholdingRate: 0.37,
      defaultSellTiming: "percent_per_year",
      defaultSellPercentPerYear: 0.25,
    });
  });

  it("still round-trips a falsy value the caller actually sent", () => {
    // `false` and `0` must survive — the fix must not confuse "absent" with
    // "falsy".
    const result = stockOptionAccountUpdateSchema.safeParse({
      sellToCover: false,
      pricePerShare: 0,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({ sellToCover: false, pricePerShare: 0 });
  });

  it("still validates the fields that ARE sent", () => {
    expect(stockOptionAccountUpdateSchema.safeParse({ withholdingRate: 1.5 }).success).toBe(
      false,
    );
    expect(stockOptionAccountUpdateSchema.safeParse({ owner: "child" }).success).toBe(false);
    expect(
      stockOptionAccountUpdateSchema.safeParse({ defaultExerciseTiming: "someday" }).success,
    ).toBe(false);
  });
});

describe("stockOptionAccountCreateSchema keeps its defaults", () => {
  it("still applies all seven defaults on create", () => {
    const result = stockOptionAccountCreateSchema.safeParse({
      name: "Equity — NVDA",
      owner: "client",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.isPublic).toBe(false);
    expect(result.data.pricePerShare).toBe(0);
    expect(result.data.autoCreateDestination).toBe(true);
    expect(result.data.sellToCover).toBe(true);
    expect(result.data.withholdingRate).toBe(0.22);
    expect(result.data.defaultExerciseTiming).toBe("at_vest");
    expect(result.data.defaultSellTiming).toBe("hold");
  });
});
