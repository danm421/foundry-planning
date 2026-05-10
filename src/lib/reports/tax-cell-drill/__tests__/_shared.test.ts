import { describe, it, expect } from "vitest";
import { resolveSourceLabel } from "../_shared";
import type { CellDrillContext } from "../types";

const ctx: CellDrillContext = {
  accountNames: { acc_1: "Joint Brokerage", acc_2: "401k" },
  incomes: [
    { id: "inc_1", name: "Spouse Salary", type: "salary", annualAmount: 0, startYear: 0, endYear: 0, growthRate: 0, owner: "spouse" } as never,
  ],
  accounts: [],
};

describe("resolveSourceLabel", () => {
  it("resolves a plain income id to its name", () => {
    expect(resolveSourceLabel("inc_1", ctx)).toBe("Spouse Salary");
  });

  it("resolves an account:kind compound id to 'Account — Kind'", () => {
    expect(resolveSourceLabel("acc_1:oi", ctx)).toBe("Joint Brokerage — OI");
    expect(resolveSourceLabel("acc_1:qdiv", ctx)).toBe("Joint Brokerage — Qual Div");
    expect(resolveSourceLabel("acc_2:rmd", ctx)).toBe("401k — RMD");
    expect(resolveSourceLabel("acc_1:stcg", ctx)).toBe("Joint Brokerage — ST CG");
    expect(resolveSourceLabel("acc_1:ltcg", ctx)).toBe("Joint Brokerage — LTCG");
  });

  it("handles withdrawal:<acctId> drill keys", () => {
    expect(resolveSourceLabel("withdrawal:acc_2", ctx)).toBe("401k — Withdrawal");
  });

  it("handles roth_conversion:<id> with a fallback name", () => {
    expect(resolveSourceLabel("roth_conversion:cv_4", ctx)).toBe("Roth conversion (cv_4)");
  });

  it("handles sale:<txId>", () => {
    expect(resolveSourceLabel("sale:tx_9", ctx)).toBe("Asset sale (tx_9)");
  });

  it("falls back to the raw id for unknown shapes", () => {
    expect(resolveSourceLabel("mystery_thing", ctx)).toBe("mystery_thing");
  });
});
