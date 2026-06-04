import { describe, it, expect } from "vitest";
import { templatePagesSchema } from "../template-descriptor-schema";

describe("templatePagesSchema", () => {
  it("accepts a valid cashFlow descriptor", () => {
    const valid = [
      { pageId: "cashFlow", options: { range: "full", showCallout: true } },
    ];
    expect(() => templatePagesSchema.parse(valid)).not.toThrow();
  });

  it("rejects an unknown pageId", () => {
    expect(() =>
      templatePagesSchema.parse([{ pageId: "balanceSheet", options: {} }]),
    ).toThrow();
  });

  it("rejects invalid cashFlow options", () => {
    expect(() =>
      templatePagesSchema.parse([{ pageId: "cashFlow", options: { range: "weird" } }]),
    ).toThrow();
  });

  it("requires at least one descriptor", () => {
    expect(() => templatePagesSchema.parse([])).toThrow();
  });
});
