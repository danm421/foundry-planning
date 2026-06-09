import { describe, it, expect } from "vitest";
import {
  entityCashFlowOptionsSchema,
  summarizeEntityCashFlowOptions,
  estimateEntityCashFlowPageCount,
} from "../options-schema";

describe("entityCashFlowOptionsSchema", () => {
  it("accepts a full-range selection", () => {
    const parsed = entityCashFlowOptionsSchema.parse({
      entityId: "t1",
      entityName: "Smith Family Trust",
      range: "full",
    });
    expect(parsed.entityId).toBe("t1");
    expect(parsed.range).toBe("full");
  });

  it("accepts a custom range", () => {
    const parsed = entityCashFlowOptionsSchema.parse({
      entityId: "b1",
      entityName: "ABC Holdings LLC",
      range: { startYear: 2026, endYear: 2050 },
    });
    expect(parsed.range).toEqual({ startYear: 2026, endYear: 2050 });
  });
});

describe("summarizeEntityCashFlowOptions", () => {
  it("summarizes a named entity over the full range", () => {
    expect(
      summarizeEntityCashFlowOptions({ entityId: "t1", entityName: "Smith Family Trust", range: "full" }),
    ).toBe("Smith Family Trust · Full range");
  });

  it("summarizes a custom range and falls back when unnamed", () => {
    expect(
      summarizeEntityCashFlowOptions({ entityId: "", entityName: "", range: { startYear: 2026, endYear: 2050 } }),
    ).toBe("No entity selected · 2026–2050");
  });
});

describe("estimateEntityCashFlowPageCount", () => {
  it("returns one page", () => {
    expect(estimateEntityCashFlowPageCount()).toBe(1);
  });
});
