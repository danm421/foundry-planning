import { describe, it, expect } from "vitest";
import { buildWithdrawalsDrillData } from "../view-model";
import { makeAccount, makeAccountsAndClient, makeYear } from "./fixtures";

const ACCOUNTS = [
  makeAccount("chk", "cash"),
  makeAccount("brok", "taxable"),
  makeAccount("ira", "retirement", "traditional_ira"),
  makeAccount("roth", "retirement", "roth_ira"),
];

/** Two years. 2040 draws cash + taxable + pre-tax; 2041 is the only year that
 *  ever touches Roth — which is what pins the column set to the FULL projection
 *  rather than the visible range. */
function years() {
  return [
    makeYear({
      year: 2039,
      liquidTotal: 1_000_000,
    }),
    makeYear({
      year: 2040,
      totalIncome: 60_000,
      withdrawals: { chk: 5_000, brok: 10_000, ira: 25_000 },
      rmds: { ira: 20_000 },
      liquidTotal: 900_000,
      living: 90_000,
      totalExpenses: 100_000,
    }),
    makeYear({
      year: 2041,
      totalIncome: 62_000,
      withdrawals: { roth: 8_000 },
      liquidTotal: 850_000,
      living: 92_000,
      totalExpenses: 102_000,
    }),
  ];
}

function build(range: "full" | { startYear: number; endYear: number } = "full") {
  return buildWithdrawalsDrillData({
    years: years(),
    clientData: makeAccountsAndClient(ACCOUNTS),
    options: { range, showCallout: false },
    scenarioLabel: "Base Case",
    clientName: "Cooper",
    spouseName: "Susan",
  });
}

describe("buildWithdrawalsDrillData", () => {
  it("reads left to right as the year's cash story", () => {
    const data = build();
    expect(data.title).toBe("Withdrawals");
    expect(data.subtitle).toBe("Base Case");
    expect(data.table.columns.map((c) => c.key)).toEqual([
      "totalIncome",
      "wd_cash",
      "wd_taxable",
      "wd_preTax",
      "wd_roth",
      "withdrawalsTotal",
      "portfolioBoy",
      "withdrawalRate",
      "livingExpenses",
      "totalExpenses",
      "netCashFlow",
    ]);
  });

  it("drops a draw source the plan never touches", () => {
    const noRoth = buildWithdrawalsDrillData({
      years: years().slice(0, 2),
      clientData: makeAccountsAndClient(ACCOUNTS),
      options: { range: "full", showCallout: false },
      scenarioLabel: "Base Case",
      clientName: "Cooper",
      spouseName: "Susan",
    });
    expect(noRoth.table.columns.map((c) => c.key)).not.toContain("wd_roth");
  });

  it("keeps the column set stable when the year range hides the only Roth year", () => {
    // 2041 is the sole Roth year and sits outside the range. The column must
    // survive: a column that appears and disappears as the advisor nudges the
    // range makes two printings of the same plan uncomparable.
    const clipped = build({ startYear: 2040, endYear: 2040 });
    expect(clipped.table.columns.map((c) => c.key)).toContain("wd_roth");
    expect(clipped.table.rows.map((r) => r.year)).toEqual([2040]);
  });

  it("splits the year's draws by tax treatment", () => {
    const row = build().table.rows.find((r) => r.year === 2040)!;
    expect(row.cells.wd_cash).toBe(5_000);
    expect(row.cells.wd_taxable).toBe(10_000);
    expect(row.cells.wd_preTax).toBe(25_000);
    expect(row.cells.wd_roth).toBe(0);
    expect(row.cells.withdrawalsTotal).toBe(40_000);
  });

  it("reconciles income minus expenses to net cash flow on every row", () => {
    for (const r of build().table.rows) {
      expect(r.cells.totalIncome - r.cells.totalExpenses).toBeCloseTo(
        r.cells.netCashFlow,
        6,
      );
    }
  });

  it("measures the withdrawal rate against the prior year's liquid portfolio, RMDs included", () => {
    const row = build().table.rows.find((r) => r.year === 2040)!;
    expect(row.cells.portfolioBoy).toBe(1_000_000);
    // (40,000 drawn + 20,000 RMD) / 1,000,000
    expect(row.cells.withdrawalRate).toBeCloseTo(0.06, 10);
  });

  it("stacks the chart by source and overlays the living-expense line", () => {
    const spec = build().chartSpec!;
    expect(spec.stacks.map((s) => s.label)).toEqual([
      "Cash",
      "Taxable",
      "Tax-Deferred",
      "Roth",
    ]);
    expect(spec.lines.map((l) => l.label)).toEqual(["Living Expenses"]);
    // One value per visible year, in the same order as the rows.
    expect(spec.stacks[0].values).toHaveLength(3);
    expect(spec.lines[0].values).toEqual([0, 90_000, 92_000]);
  });

  it("clips rows to the range but still finds the denominator outside it", () => {
    const clipped = build({ startYear: 2041, endYear: 2041 });
    expect(clipped.table.rows).toHaveLength(1);
    // 2040 is outside the range yet still supplies 2041's BoY.
    expect(clipped.table.rows[0].cells.portfolioBoy).toBe(900_000);
  });

  it("carries the callout only when the advisor turned it on", () => {
    expect(build().callout).toBeUndefined();
    const withCallout = buildWithdrawalsDrillData({
      years: years(),
      clientData: makeAccountsAndClient(ACCOUNTS),
      options: { range: "full", showCallout: true, calloutText: "Roth last." },
      scenarioLabel: "Base Case",
      clientName: "Cooper",
      spouseName: "Susan",
    });
    expect(withCallout.callout).toBe("Roth last.");
  });
});
