import { describe, it, expect } from "vitest";
import { buildTaxFederalDatasets } from "../tax-federal-chart";
import { makeYear } from "./fixtures";

describe("buildTaxFederalDatasets", () => {
  it("returns one series per federal tax component", () => {
    const labels = buildTaxFederalDatasets().map((s) => s.label);
    expect(labels).toEqual([
      "Ordinary (Bracket)",
      "Cap Gains / QDIV",
      "NIIT",
      "AMT",
    ]);
  });

  it("returns zero when taxResult is absent", () => {
    const y = makeYear({ year: 2026 });
    const series = buildTaxFederalDatasets();
    for (const s of series) expect(s.valueFor(y)).toBe(0);
  });

  it("reads the matching flow field when taxResult is present", () => {
    const y = makeYear({
      year: 2026,
      taxResult: {
        flow: {
          regularFederalIncomeTax: 25_000,
          capitalGainsTax: 8_000,
          niit: 1_140,
          amtAdditional: 500,
        },
      } as any,
    });
    const series = buildTaxFederalDatasets();
    expect(series.find((s) => s.label === "Ordinary (Bracket)")!.valueFor(y)).toBe(25_000);
    expect(series.find((s) => s.label === "Cap Gains / QDIV")!.valueFor(y)).toBe(8_000);
    expect(series.find((s) => s.label === "NIIT")!.valueFor(y)).toBe(1_140);
    expect(series.find((s) => s.label === "AMT")!.valueFor(y)).toBe(500);
  });
});
