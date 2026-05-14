import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import {
  leverSearchConfig,
  buildLeverMutation,
  SAVINGS_HARD_CAP,
  SAVINGS_ZERO_DEFAULT_HI,
  SAVINGS_SOURCE_MULTIPLIER,
} from "../lever-search-config";

const emptyTree = {
  client: {},
  accounts: [],
  incomes: [],
  expenses: [],
  liabilities: [],
  savingsRules: [],
  withdrawalStrategy: [],
  planSettings: {},
  giftEvents: [],
} as unknown as ClientData;

describe("leverSearchConfig", () => {
  it("retirement-age: range 50-80 step 1 d=+1", () => {
    expect(
      leverSearchConfig({ kind: "retirement-age", person: "client" }, emptyTree),
    ).toEqual({ lo: 50, hi: 80, step: 1, direction: 1 });
  });

  it("living-expense-scale: range 0.5-1.5 step 0.01 d=-1", () => {
    expect(leverSearchConfig({ kind: "living-expense-scale" }, emptyTree)).toEqual({
      lo: 0.5,
      hi: 1.5,
      step: 0.01,
      direction: -1,
    });
  });

  it("ss-claim-age: range 62-70 step 1 d=+1", () => {
    expect(
      leverSearchConfig({ kind: "ss-claim-age", person: "spouse" }, emptyTree),
    ).toEqual({ lo: 62, hi: 70, step: 1, direction: 1 });
  });

  it("savings-contribution: hi = source × multiplier, capped at hard cap", () => {
    const tree = {
      ...emptyTree,
      savingsRules: [
        { id: "r1", accountId: "a1", annualAmount: 5_000, startYear: 2020, endYear: 2040 },
      ],
    } as unknown as ClientData;
    const cfg = leverSearchConfig(
      { kind: "savings-contribution", accountId: "a1" },
      tree,
    );
    expect(cfg).toEqual({
      lo: 0,
      hi: 5_000 * SAVINGS_SOURCE_MULTIPLIER,
      step: 1000,
      direction: 1,
    });
  });

  it("savings-contribution: hi caps at SAVINGS_HARD_CAP when source × multiplier exceeds it", () => {
    const tree = {
      ...emptyTree,
      savingsRules: [
        { id: "r1", accountId: "a1", annualAmount: 50_000, startYear: 2020, endYear: 2040 },
      ],
    } as unknown as ClientData;
    const cfg = leverSearchConfig(
      { kind: "savings-contribution", accountId: "a1" },
      tree,
    );
    expect(cfg.hi).toBe(SAVINGS_HARD_CAP);
  });

  it("savings-contribution: source=0 returns SAVINGS_ZERO_DEFAULT_HI", () => {
    const tree = {
      ...emptyTree,
      savingsRules: [
        { id: "r1", accountId: "a1", annualAmount: 0, startYear: 2020, endYear: 2040 },
      ],
    } as unknown as ClientData;
    const cfg = leverSearchConfig(
      { kind: "savings-contribution", accountId: "a1" },
      tree,
    );
    expect(cfg.hi).toBe(SAVINGS_ZERO_DEFAULT_HI);
  });

  it("savings-contribution: account not in tree returns SAVINGS_ZERO_DEFAULT_HI", () => {
    const cfg = leverSearchConfig(
      { kind: "savings-contribution", accountId: "missing" },
      emptyTree,
    );
    expect(cfg.hi).toBe(SAVINGS_ZERO_DEFAULT_HI);
  });
});

describe("buildLeverMutation", () => {
  it("retirement-age", () => {
    expect(buildLeverMutation({ kind: "retirement-age", person: "client" }, 67)).toEqual({
      kind: "retirement-age",
      person: "client",
      age: 67,
    });
  });

  it("living-expense-scale", () => {
    expect(buildLeverMutation({ kind: "living-expense-scale" }, 1.1)).toEqual({
      kind: "living-expense-scale",
      multiplier: 1.1,
    });
  });

  it("ss-claim-age", () => {
    expect(buildLeverMutation({ kind: "ss-claim-age", person: "spouse" }, 68)).toEqual({
      kind: "ss-claim-age",
      person: "spouse",
      age: 68,
    });
  });

  it("savings-contribution", () => {
    expect(
      buildLeverMutation({ kind: "savings-contribution", accountId: "a1" }, 25_000),
    ).toEqual({
      kind: "savings-contribution",
      accountId: "a1",
      annualAmount: 25_000,
    });
  });
});
