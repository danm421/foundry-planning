import { describe, it, expect } from "vitest";
import { eligibleLoans, targetLoan, payoffYear, loanWindow } from "../target-loan";
import type { ClientData, Liability } from "@/engine/types";
// NOT `@/engine/types` — `ProjectionResult` is re-exported from the engine's
// index, off `./projection`.
import type { ProjectionResult } from "@/engine";

const loan = (over: Partial<Liability> & { id: string }): Liability =>
  ({
    name: over.id, balance: 30_000, interestRate: 0.055, monthlyPayment: 350,
    startYear: 2024, startMonth: 1, termMonths: 120, extraPayments: [], owners: [],
    ...over,
  }) as Liability;

const tree = (liabilities: Liability[]): ClientData =>
  ({ planSettings: { planStartYear: 2026, inflationRate: 0.03 }, liabilities }) as unknown as ClientData;

describe("eligibleLoans", () => {
  it("drops a credit card — the engine holds it flat, so an extra payment vanishes", () => {
    expect(eligibleLoans(tree([loan({ id: "cc", liabilityType: "credit_card" })]))).toEqual([]);
  });

  it("drops a liability with no amortization term", () => {
    expect(eligibleLoans(tree([loan({ id: "plaid", termMonths: 0 })]))).toEqual([]);
  });

  it("drops a loan already paid off", () => {
    expect(eligibleLoans(tree([loan({ id: "done", balance: 0 })]))).toEqual([]);
  });

  it("keeps an amortizing loan with a balance", () => {
    expect(eligibleLoans(tree([loan({ id: "student" })])).map((l) => l.id)).toEqual(["student"]);
  });
});

describe("targetLoan", () => {
  it("takes the advisor's pick when it is still eligible", () => {
    const data = tree([loan({ id: "a", balance: 10_000 }), loan({ id: "b", balance: 90_000 })]);
    expect(targetLoan(data, "a")?.id).toBe("a");
  });

  it("falls back to the largest balance when the pick is gone", () => {
    const data = tree([loan({ id: "a", balance: 10_000 }), loan({ id: "b", balance: 90_000 })]);
    expect(targetLoan(data, "deleted")?.id).toBe("b");
    expect(targetLoan(data, null)?.id).toBe("b");
  });

  it("is null when nothing is eligible", () => {
    expect(targetLoan(tree([]), null)).toBeNull();
  });
});

describe("payoffYear", () => {
  const projection = (balances: Array<[number, number]>): ProjectionResult =>
    ({
      years: balances.map(([year, bal]) => ({ year, liabilityBalancesBoY: { l1: bal } })),
    }) as unknown as ProjectionResult;

  it("is the year AFTER the last one that still carries a balance", () => {
    expect(payoffYear(projection([[2026, 30_000], [2027, 16_000], [2028, 0]]), "l1")).toBe(2028);
  });

  it("is null for a loan the projection never carries", () => {
    expect(payoffYear(projection([[2026, 0]]), "l1")).toBeNull();
  });
});

describe("loanWindow", () => {
  const source = (liabilities: Liability[], balances: Array<[number, number]>) => ({
    clientData: tree(liabilities),
    projection: {
      years: balances.map(([year, bal]) => ({ year, liabilityBalancesBoY: { l1: bal } })),
    } as unknown as ProjectionResult,
  });

  it("resolves the loan and the year the base plan clears it", () => {
    const w = loanWindow(source([loan({ id: "l1" })], [[2026, 30_000], [2027, 0]]), null);
    expect(w?.loan.id).toBe("l1");
    expect(w?.endYear).toBe(2027);
  });

  it("is null when no loan is eligible — neither arm has anywhere to go", () => {
    expect(loanWindow(source([], [[2026, 0]]), null)).toBeNull();
  });

  it("is null when the projection never carries the loan", () => {
    expect(loanWindow(source([loan({ id: "l1" })], [[2026, 0]]), null)).toBeNull();
  });
});
