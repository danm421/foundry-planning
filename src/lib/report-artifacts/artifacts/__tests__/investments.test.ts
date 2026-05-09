import { describe, it, expect, vi } from "vitest";
import { investmentsArtifact } from "../investments";

vi.mock("@/db", () => ({ db: { select: vi.fn() } }));

describe("investmentsArtifact", () => {
  it("registers id, title, section, route", () => {
    expect(investmentsArtifact.id).toBe("investments");
    expect(investmentsArtifact.title).toBe("Investments");
    expect(investmentsArtifact.section).toBe("assets");
    expect(investmentsArtifact.route).toContain("/assets/investments");
  });

  it("declares variants chart, data, chart+data, csv", () => {
    expect(investmentsArtifact.variants.slice().sort()).toEqual(["chart", "chart+data", "csv", "data"]);
  });

  it("optionsSchema includes drillDownClasses array", () => {
    const parsed = investmentsArtifact.optionsSchema.parse({});
    expect(parsed).toEqual(investmentsArtifact.defaultOptions);
    const parsed2 = investmentsArtifact.optionsSchema.parse({
      drillDownClasses: ["equities", "fixed_income"],
    });
    expect(parsed2.drillDownClasses).toEqual(["equities", "fixed_income"]);
  });

  it("toCsv exists and returns at least the holdings file", () => {
    expect(typeof investmentsArtifact.toCsv).toBe("function");
  });
});
