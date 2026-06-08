import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import { compareEffectiveTrees } from "../promote-self-check";

const cd = (o: Record<string, unknown>) => o as unknown as ClientData;

const tree = (val: number) =>
  cd({
    accounts: [{ id: "x", name: "A", value: val, source: "manual" }],
    expenses: [{ id: "p", name: "Premium", annualAmount: 5, source: "policy" }], // synthesized → excluded
  });

describe("compareEffectiveTrees", () => {
  it("treats trees equal up to ids + synthesized policy rows", () => {
    const r = compareEffectiveTrees(
      tree(100),
      cd({
        ...(tree(100) as unknown as Record<string, unknown>),
        accounts: [{ id: "DIFFERENT", name: "A", value: 100, source: "manual" }],
      }),
    );
    expect(r.equal).toBe(true);
  });

  it("flags a real value difference", () => {
    const r = compareEffectiveTrees(tree(100), tree(200));
    expect(r.equal).toBe(false);
    expect(r.diffs[0]).toContain("accounts");
  });

  it("tolerates uuid churn in reference columns", () => {
    const expected = {
      savingsRules: [
        { id: "11111111-1111-1111-1111-111111111111", accountId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", amount: 500 },
      ],
    } as never;
    const actual = {
      savingsRules: [
        { id: "22222222-2222-2222-2222-222222222222", accountId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", amount: 500 },
      ],
    } as never;
    expect(compareEffectiveTrees(expected, actual).equal).toBe(true);
  });

  it("detects a missing row (unhandled kind)", () => {
    const expected = { incomes: [{ id: "i1", name: "Salary", annualAmount: 100, source: "manual" }] } as never;
    const actual = { incomes: [] } as never;
    const r = compareEffectiveTrees(expected, actual);
    expect(r.equal).toBe(false);
    expect(r.diffs[0]).toContain("incomes");
  });

  it("detects a singleton (planSettings) difference", () => {
    const r = compareEffectiveTrees(
      { planSettings: { id: "ps", inflationRate: 0.03 } } as never,
      { planSettings: { id: "ps2", inflationRate: 0.025 } } as never,
    );
    expect(r.equal).toBe(false);
    expect(r.diffs[0]).toContain("planSettings");
  });

  it("ignores derived giftEvents entirely", () => {
    const r = compareEffectiveTrees(
      { giftEvents: [{ year: 2030, amount: 1 }] } as never,
      { giftEvents: [] } as never,
    );
    expect(r.equal).toBe(true);
  });
});
