import { describe, it, expect } from "vitest";
import { cashflowArtifact } from "../cashflow";

describe("cashflowArtifact (skeleton)", () => {
  it("registers id, title, section, route", () => {
    expect(cashflowArtifact.id).toBe("cashflow");
    expect(cashflowArtifact.title).toBe("Cash Flow");
    expect(cashflowArtifact.section).toBe("cashflow");
    expect(cashflowArtifact.route).toBe("/clients/[id]/cashflow");
  });

  it("declares variants chart, data, chart+data, csv", () => {
    expect(cashflowArtifact.variants.slice().sort()).toEqual([
      "chart",
      "chart+data",
      "csv",
      "data",
    ]);
  });

  it("optionsSchema parses an empty object to defaultOptions", () => {
    const parsed = cashflowArtifact.optionsSchema.parse({});
    expect(parsed).toEqual(cashflowArtifact.defaultOptions);
  });

  it("defaultOptions has nullable scenarioId and yearStart/yearEnd", () => {
    expect(cashflowArtifact.defaultOptions).toEqual({
      scenarioId: null,
      yearStart: null,
      yearEnd: null,
    });
  });

  it("toCsv exists", () => {
    expect(typeof cashflowArtifact.toCsv).toBe("function");
  });
});
