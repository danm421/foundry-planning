import { describe, it, expect } from "vitest";
import {
  ComparisonLayoutSchema,
  ComparisonLayoutItemSchema,
} from "../layout-schema";

describe("ComparisonLayoutItemSchema", () => {
  it("accepts a v3 item (no hidden/collapsed fields)", () => {
    const parsed = ComparisonLayoutItemSchema.parse({
      instanceId: "11111111-1111-4111-8111-111111111111",
      kind: "portfolio",
    });
    expect(parsed.kind).toBe("portfolio");
    // hidden/collapsed must not be on the parsed shape
    expect("hidden" in parsed).toBe(false);
    expect("collapsed" in parsed).toBe(false);
  });

  it("strips unknown legacy fields like hidden/collapsed", () => {
    const parsed = ComparisonLayoutItemSchema.parse({
      instanceId: "11111111-1111-4111-8111-111111111111",
      kind: "portfolio",
      hidden: true,
      collapsed: true,
    });
    expect("hidden" in parsed).toBe(false);
    expect("collapsed" in parsed).toBe(false);
  });

  it("rejects unknown kinds", () => {
    expect(() =>
      ComparisonLayoutItemSchema.parse({
        instanceId: "11111111-1111-4111-8111-111111111111",
        kind: "unknown-widget",
      }),
    ).toThrow();
  });

  it("rejects malformed instanceId", () => {
    expect(() =>
      ComparisonLayoutItemSchema.parse({ instanceId: "not-a-uuid", kind: "portfolio" }),
    ).toThrow();
  });

  it("passes through optional config", () => {
    const parsed = ComparisonLayoutItemSchema.parse({
      instanceId: "11111111-1111-4111-8111-111111111111",
      kind: "text",
      config: { markdown: "Hello **world**" },
    });
    expect(parsed.config).toEqual({ markdown: "Hello **world**" });
  });
});

describe("ComparisonLayoutSchema", () => {
  it("requires version: 3", () => {
    expect(() =>
      ComparisonLayoutSchema.parse({ version: 2, yearRange: null, items: [] }),
    ).toThrow();
  });

  it("accepts an empty items array with null yearRange", () => {
    const parsed = ComparisonLayoutSchema.parse({
      version: 3,
      yearRange: null,
      items: [],
    });
    expect(parsed.items).toEqual([]);
    expect(parsed.yearRange).toBeNull();
  });

  it("accepts a valid yearRange", () => {
    const parsed = ComparisonLayoutSchema.parse({
      version: 3,
      yearRange: { start: 2030, end: 2055 },
      items: [],
    });
    expect(parsed.yearRange).toEqual({ start: 2030, end: 2055 });
  });

  it("rejects yearRange where start > end", () => {
    expect(() =>
      ComparisonLayoutSchema.parse({
        version: 3,
        yearRange: { start: 2055, end: 2030 },
        items: [],
      }),
    ).toThrow();
  });
});
