import { describe, it, expect } from "vitest";
import { buildIncomeRows } from "../build-income-rows";
import { toSalaryOptions } from "@/lib/savings/salary-options";
import type { Income } from "@/engine/types";

const income = (over: Partial<Income> = {}): Income => ({
  id: "inc-1",
  type: "salary",
  name: "Base Salary",
  annualAmount: 200_000,
  startYear: 2026,
  endYear: 2040,
  growthRate: 0.03,
  owner: "client",
  ...over,
});

describe("buildIncomeRows", () => {
  it("carries the fields the balance sheet's two consumers read", () => {
    const [row] = buildIncomeRows([
      income({ ownerAccountId: "acct-biz", inflationStartYear: 2026 }),
    ]);
    expect(row).toEqual({
      id: "inc-1",
      type: "salary",
      name: "Base Salary",
      annualAmount: 200_000,
      owner: "client",
      ownerEntityId: null,
      ownerAccountId: "acct-biz",
      startYear: 2026,
      endYear: 2040,
      growthRate: 0.03,
      inflationStartYear: 2026,
    });
  });

  it("nulls the fields the engine leaves undefined", () => {
    // The rows cross the server→client boundary, where `undefined` does not
    // survive serialization as a distinct value.
    const [row] = buildIncomeRows([income()]);
    expect(row.ownerEntityId).toBeNull();
    expect(row.ownerAccountId).toBeNull();
    expect(row.inflationStartYear).toBeNull();
  });

  it("produces rows the salary-basis picker can actually read", () => {
    // The reason `type` and `owner` are on the row at all. A producer that
    // dropped either would not throw — `toSalaryOptions` would just match
    // nothing, and the Add Account dialog would tell the advisor a plan full
    // of salaries has none.
    const rows = buildIncomeRows([
      income({ id: "inc-1", owner: "client" }),
      income({ id: "inc-2", owner: "spouse", name: "Consulting" }),
      income({ id: "inc-3", type: "social_security", name: "Social Security" }),
      income({ id: "inc-4", name: "Trust Salary", ownerEntityId: "ent-1" }),
    ]);
    expect(
      toSalaryOptions(rows, { clientName: "Jane Doe", spouseName: "John Doe" }),
    ).toEqual([
      { id: "inc-1", name: "Base Salary", ownerLabel: "Jane" },
      { id: "inc-2", name: "Consulting", ownerLabel: "John" },
    ]);
  });
});
