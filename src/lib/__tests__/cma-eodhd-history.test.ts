import { describe, it, expect } from "vitest";
import { fetchMonthlyAdjustedClose } from "../cma-eodhd-history";

const FIXTURE = [
  { date: "1996-01-31", adjusted_close: 10.1, close: 9.0 },
  { date: "1996-02-29", adjusted_close: 10.4, close: 9.1 },
];

describe("fetchMonthlyAdjustedClose", () => {
  it("maps EODHD rows to {date, adjClose} using adjusted_close", async () => {
    const bars = await fetchMonthlyAdjustedClose(
      "VFINX.US",
      { from: "1996-01-01" },
      { fetchJson: async () => FIXTURE, apiKey: "test" },
    );
    expect(bars).toEqual([
      { date: "1996-01-31", adjClose: 10.1 },
      { date: "1996-02-29", adjClose: 10.4 },
    ]);
  });

  it("throws when the API key is missing", async () => {
    await expect(
      fetchMonthlyAdjustedClose("VFINX.US", { from: "1996-01-01" }, { apiKey: "" }),
    ).rejects.toThrow(/EODHD_API_KEY/);
  });

  it("passes symbol, period=m, and from to the fetcher URL", async () => {
    let seen = "";
    await fetchMonthlyAdjustedClose(
      "VFINX.US",
      { from: "1996-01-01" },
      {
        apiKey: "test",
        fetchJson: async (url) => {
          seen = url;
          return [];
        },
      },
    );
    expect(seen).toContain("/eod/VFINX.US");
    expect(seen).toContain("period=m");
    expect(seen).toContain("from=1996-01-01");
    expect(seen).toContain("fmt=json");
  });
});
