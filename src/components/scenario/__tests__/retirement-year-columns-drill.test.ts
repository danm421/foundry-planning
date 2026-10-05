import { describe, it, expect } from "vitest";
import { retirementYearColumns } from "../retirement-year-columns";
import type { ClientData, ProjectionYear } from "@/engine";

const clientData = {
  client: { firstName: "A", lastName: "B" },
  incomes: [], entities: [], accounts: [], liabilities: [], expenses: [],
  assetTransactions: [], stockOptionPlans: [], notesReceivable: [], medicareCoverage: [],
} as unknown as ClientData;

// A retired couple: no salary, no RMDs, no savings in any year.
function makeYear(year: number): ProjectionYear {
  return {
    year,
    ages: { client: 70, spouse: 68 },
    income: { socialSecurity: 50_000, salaries: 0, total: 56_000, bySource: {} },
    accountLedgers: {},
    withdrawals: { total: 40_000, byAccount: {} },
    expenses: {
      living: 70_000, taxes: 8_000, liabilities: 0, other: 18_000, insurance: 0,
      realEstate: 0, discretionary: 0, total: 96_000,
      bySource: {}, byLiability: {}, interestByLiability: {},
    },
    savings: { total: 0, byAccount: {}, employerTotal: 0 },
    totalIncome: 56_000,
    totalExpenses: 96_000,
    portfolioAssets: { taxable: {}, cash: {}, retirement: {}, taxableTotal: 900_000, cashTotal: 0, retirementTotal: 0 },
  } as unknown as ProjectionYear;
}

const years = [makeYear(2040), makeYear(2041)];

describe("retirementYearColumns", () => {
  it("groups the columns as Cash In, then Cash Out, then the net and the portfolio", () => {
    const cols = retirementYearColumns(years, true, clientData);
    expect(cols.map((c) => [c.key, c.group])).toEqual([
      ["year", undefined],
      ["age", undefined],
      ["socialSecurity", "Cash In"],
      ["otherIncome", "Cash In"],
      ["withdrawals", "Cash In"],
      ["totalIn", "Cash In"],
      ["livingExpenses", "Cash Out"],
      ["taxes", "Cash Out"],
      ["otherExpenses", "Cash Out"],
      ["totalOut", "Cash Out"],
      ["net", undefined],
      ["portfolioAssets", undefined],
    ]);
  });

  it("hides a component column that is $0 in every year, but never a total", () => {
    const keys = retirementYearColumns(years, true, clientData).map((c) => c.key);
    expect(keys).not.toContain("salaries");
    expect(keys).not.toContain("rmds");
    expect(keys).not.toContain("savings");
    expect(keys).toEqual(expect.arrayContaining(["totalIn", "totalOut", "net", "portfolioAssets"]));
  });

  it("gives every money column a drill fn", () => {
    for (const col of retirementYearColumns(years, true, clientData)) {
      if (col.key === "year" || col.key === "age") expect(col.drill, col.key).toBeUndefined();
      else expect(col.drill, col.key).toBeTypeOf("function");
    }
  });

  it("prints a shortfall in parentheses, flagged critical", () => {
    const net = retirementYearColumns(years, true, clientData).find((c) => c.key === "net")!;
    // In 56k + 40k = 96k against Out 96k breaks even; lift Out to force a gap.
    const short = { ...makeYear(2042), totalExpenses: 100_000 } as ProjectionYear;
    expect(net.render(short)).toBe("($4,000)");
    expect(net.tone?.(short)).toBe("crit");
    expect(net.tone?.(years[0])).toBe("default");
  });

  it("prints a break-even year's float residue as $0, not ($0)", () => {
    const net = retirementYearColumns(years, true, clientData).find((c) => c.key === "net")!;
    const residue = { ...makeYear(2042), totalExpenses: 96_000.3 } as ProjectionYear;
    expect(net.render(residue)).toBe("$0");
    expect(net.tone?.(residue)).toBe("default");
  });
});
