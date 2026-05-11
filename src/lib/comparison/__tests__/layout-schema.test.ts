import { describe, it, expect } from "vitest";
import {
  ComparisonLayoutSchema,
  ComparisonLayoutItemSchema,
} from "../layout-schema";

describe("ComparisonLayoutItemSchema", () => {
  it("accepts a valid item with all fields", () => {
    const parsed = ComparisonLayoutItemSchema.parse({
      instanceId: "11111111-1111-4111-8111-111111111111",
      kind: "portfolio",
      hidden: false,
      collapsed: false,
    });
    expect(parsed.kind).toBe("portfolio");
    expect(parsed.hidden).toBe(false);
  });

  it("defaults hidden + collapsed when omitted", () => {
    const parsed = ComparisonLayoutItemSchema.parse({
      instanceId: "11111111-1111-4111-8111-111111111111",
      kind: "kpi-strip",
    });
    expect(parsed.hidden).toBe(false);
    expect(parsed.collapsed).toBe(false);
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
  it("requires version: 1", () => {
    expect(() => ComparisonLayoutSchema.parse({ version: 2, items: [] })).toThrow();
  });

  it("accepts an empty items array", () => {
    expect(ComparisonLayoutSchema.parse({ version: 1, items: [] }).items).toEqual([]);
  });
});
