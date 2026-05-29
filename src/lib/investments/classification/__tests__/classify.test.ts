// src/lib/investments/classification/__tests__/classify.test.ts
import { describe, it, expect } from "vitest";
import { classifySecurity } from "../classify";

describe("classifySecurity", () => {
  it("classifies a ticker via injected EODHD fetcher", async () => {
    const result = await classifySecurity("VTI", {
      fetchEodhd: async () => ({
        General: { Name: "Vanguard Total Stock Market ETF", Type: "ETF" },
        ETF_Data: {
          Asset_Allocation: { "Stock US": { "Net_Assets_%": "100" } },
          Market_Capitalisation: { Mega: "50", Big: "30", Medium: "12", Small: "6", Micro: "2" },
          World_Regions: { "North America": { "Equity_%": "100" } },
          Sector_Weights: {},
          MorningStar: { Category_Benchmark: "CRSP US Total Market" },
        },
      }),
    });
    expect(result).not.toBeNull();
    expect(result!.identifier).toBe("VTI");
    expect(result!.securityType).toBe("etf");
    expect(result!.classifierSource).toBe("eodhd");
    const total = result!.weights.reduce((a, w) => a + w.weight, 0);
    expect(Number(total.toFixed(4))).toBe(1);
  });

  it("fails soft (returns null) when the fetcher throws", async () => {
    const result = await classifySecurity("ZZZZ", {
      fetchEodhd: async () => { throw new Error("HTTP 404"); },
    });
    expect(result).toBeNull();
  });
});
