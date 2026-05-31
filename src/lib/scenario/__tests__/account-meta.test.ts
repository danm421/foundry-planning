import { describe, it, expect } from "vitest";
import { overlayAccountMeta, type AccountMeta } from "../account-meta";

const baseRow = (over: Partial<AccountMeta> = {}): AccountMeta => ({
  id: "a1",
  growthSource: "default",
  modelPortfolioId: null,
  turnoverPct: null,
  overridePctOi: null,
  overridePctLtCg: null,
  overridePctQdiv: null,
  overridePctTaxExempt: null,
  annualPropertyTax: null,
  propertyTaxGrowthRate: null,
  propertyTaxGrowthSource: null,
  ...over,
});

describe("overlayAccountMeta (F11)", () => {
  it("returns the base map unchanged when there are no changes", () => {
    const base = [baseRow()];
    const map = overlayAccountMeta(base, []);
    expect(map.get("a1")).toEqual(base[0]);
  });

  it("merges an edit diff's `to` values and preserves untouched fields", () => {
    const base = [baseRow({ turnoverPct: "0.05" })];
    const map = overlayAccountMeta(base, [
      {
        targetKind: "account",
        opType: "edit",
        targetId: "a1",
        payload: {
          growthSource: { from: "default", to: "model_portfolio" },
          modelPortfolioId: { from: null, to: "mp-1" },
        },
      },
    ]);
    const m = map.get("a1")!;
    expect(m.growthSource).toBe("model_portfolio");
    expect(m.modelPortfolioId).toBe("mp-1");
    expect(m.turnoverPct).toBe("0.05"); // untouched base field preserved
  });

  it("inserts a scenario-added account with other keys null and stringifies numerics", () => {
    const map = overlayAccountMeta([], [
      {
        targetKind: "account",
        opType: "add",
        targetId: "new-1",
        payload: { id: "new-1", growthSource: "inflation", turnoverPct: 0.1 },
      },
    ]);
    const m = map.get("new-1")!;
    expect(m.growthSource).toBe("inflation");
    expect(m.turnoverPct).toBe("0.1"); // numeric coerced to string
    expect(m.modelPortfolioId).toBeNull();
  });

  it("drops an account removed by the scenario", () => {
    const map = overlayAccountMeta([baseRow()], [
      { targetKind: "account", opType: "remove", targetId: "a1", payload: null },
    ]);
    expect(map.has("a1")).toBe(false);
  });

  it("ignores changes whose targetKind is not 'account'", () => {
    const base = [baseRow()];
    const map = overlayAccountMeta(base, [
      {
        targetKind: "income",
        opType: "edit",
        targetId: "a1",
        payload: { growthSource: { from: "default", to: "should-not-apply" } },
      },
    ]);
    expect(map.get("a1")!.growthSource).toBe("default");
  });
});
