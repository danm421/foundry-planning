import { describe, it, expect } from "vitest";
import { describeChangeTarget } from "./describe-change-target";

const accounts = new Map<string, { name: string }>([
  ["acc-401k", { name: "401(k)" }],
]);

describe("describeChangeTarget", () => {
  it("returns the entity name for name-bearing kinds", () => {
    expect(
      describeChangeTarget("income", { id: "i1", name: "Salary" }, accounts),
    ).toBe("Salary");
  });

  it("trims and ignores blank names", () => {
    expect(
      describeChangeTarget("expense", { id: "e1", name: "  " }, accounts),
    ).toBeNull();
  });

  it("savings_rule: account + max", () => {
    expect(
      describeChangeTarget(
        "savings_rule",
        { id: "s1", accountId: "acc-401k", contributeMax: true },
        accounts,
      ),
    ).toBe("401(k) · max");
  });

  it("savings_rule: account + percent of salary (fraction → percent)", () => {
    expect(
      describeChangeTarget(
        "savings_rule",
        { id: "s1", accountId: "acc-401k", annualPercent: 0.06 },
        accounts,
      ),
    ).toBe("401(k) · 6% of salary");
  });

  it("savings_rule: account + compact annual amount", () => {
    expect(
      describeChangeTarget(
        "savings_rule",
        { id: "s1", accountId: "acc-401k", annualAmount: 15000 },
        accounts,
      ),
    ).toBe("401(k) · $15k/yr");
  });

  it("savings_rule: unresolved account falls back to basis only", () => {
    expect(
      describeChangeTarget(
        "savings_rule",
        { id: "s1", accountId: "missing", annualAmount: 500 },
        accounts,
      ),
    ).toBe("$500/yr");
  });

  it("will: client grantor uses client first name when given", () => {
    expect(
      describeChangeTarget("will", { id: "w1", grantor: "client" }, accounts, "Cooper"),
    ).toBe("Cooper's will");
  });

  it("will: client grantor without name", () => {
    expect(
      describeChangeTarget("will", { id: "w1", grantor: "client" }, accounts),
    ).toBe("Client's will");
  });

  it("will: spouse grantor", () => {
    expect(
      describeChangeTarget("will", { id: "w1", grantor: "spouse" }, accounts),
    ).toBe("Spouse's will");
  });

  it("returns null for an un-nameable unknown entity", () => {
    expect(
      describeChangeTarget("savings_rule", { id: "s1" }, accounts),
    ).toBeNull();
  });

  it("returns null for non-object entities", () => {
    expect(describeChangeTarget("income", null, accounts)).toBeNull();
  });
});
