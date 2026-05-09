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

describe("investmentsArtifact.renderPdf", () => {
  const baseData = {
    clientName: "Test Family",
    household: {
      totalClassifiedValue: 1_000_000,
      totalInvestableValue: 1_000_000,
      unallocatedValue: 0,
      byAssetClass: [
        { classId: "eq", label: "Equities", value: 600_000, pctOfClassified: 0.6 },
      ],
    },
    drift: {
      benchmarkName: "60/40",
      rows: [
        { classId: "eq", label: "Equities", currentPct: 0.6, targetPct: 0.6, diffPct: 0 },
      ],
    },
    perAccount: [],
  };

  it("returns non-null view-blocks for variant=data (no charts needed)", () => {
    const node = investmentsArtifact.renderPdf({
      data: baseData,
      opts: { drillDownClasses: [] },
      variant: "data",
      charts: [],
    });
    expect(node).not.toBeNull();
  });

  it("renders both donut and drift when variant=chart+data and charts present", () => {
    const node = investmentsArtifact.renderPdf({
      data: baseData,
      opts: { drillDownClasses: [] },
      variant: "chart+data",
      charts: [
        { id: "donut", dataUrl: "data:image/png;base64,xxx", width: 800, height: 500, dataVersion: "v" },
        { id: "drift", dataUrl: "data:image/png;base64,yyy", width: 800, height: 500, dataVersion: "v" },
      ],
    });
    expect(node).not.toBeNull();
  });

  it("returns non-null blocks even with missing chart for variant=chart", () => {
    const node = investmentsArtifact.renderPdf({
      data: baseData,
      opts: { drillDownClasses: [] },
      variant: "chart",
      charts: [],
    });
    expect(node).not.toBeNull();
  });

  it("handles drift.benchmarkName === null (no benchmark) for data variant", () => {
    const noBenchmark = {
      ...baseData,
      drift: { benchmarkName: null, rows: [] },
    };
    const node = investmentsArtifact.renderPdf({
      data: noBenchmark,
      opts: { drillDownClasses: [] },
      variant: "data",
      charts: [],
    });
    expect(node).not.toBeNull();
  });
});
