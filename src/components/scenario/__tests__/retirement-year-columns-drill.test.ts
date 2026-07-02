import { describe, it, expect } from "vitest";
import { retirementYearColumns } from "../retirement-year-columns";
import type { ClientData } from "@/engine";

const clientData = {
  client: { firstName: "A", lastName: "B" },
  incomes: [], entities: [], accounts: [], liabilities: [], expenses: [],
  assetTransactions: [], stockOptionPlans: [], notesReceivable: [], medicareCoverage: [],
} as unknown as ClientData;

const MONEY_KEYS = [
  "socialSecurity", "salaries", "otherIncome", "rmds", "withdrawals",
  "totalIncomeWithdrawals", "livingExpenses", "taxes", "totalExpenses",
  "shortfall", "portfolioAssets",
];

describe("retirementYearColumns drill wiring", () => {
  it("gives every money column a drill fn", () => {
    const cols = retirementYearColumns(true, clientData);
    for (const key of MONEY_KEYS) {
      expect(cols.find((c) => c.key === key)?.drill, key).toBeTypeOf("function");
    }
    expect(cols.find((c) => c.key === "year")?.drill).toBeUndefined();
    expect(cols.find((c) => c.key === "age")?.drill).toBeUndefined();
  });
});
