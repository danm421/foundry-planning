import { describe, it, expect } from "vitest";
import { overlayAccountMeta, type AccountMeta } from "../account-meta";

const baseRow = (over: Partial<AccountMeta> = {}): AccountMeta => ({
  id: "a1",
  growthSource: "default",
  modelPortfolioId: null,
  tickerPortfolioId: null,
  turnoverPct: null,
  overridePctOi: null,
  overridePctLtCg: null,
  overridePctQdiv: null,
  overridePctTaxExempt: null,
  annualPropertyTax: null,
  propertyTaxGrowthRate: null,
  propertyTaxGrowthSource: null,
  notes: null,
  growthRate: null,
  countsTowardAum: false,
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

  it("overlays countsTowardAum as a real boolean, not the string \"true\"", () => {
    const map = overlayAccountMeta(
      [baseRow({ countsTowardAum: false })],
      [
        {
          targetKind: "account",
          opType: "edit",
          targetId: "a1",
          payload: { countsTowardAum: { from: false, to: true } },
        },
      ],
    );
    expect(map.get("a1")!.countsTowardAum).toBe(true);
  });

  it("preserves countsTowardAum when an unrelated field is edited", () => {
    const map = overlayAccountMeta(
      [baseRow({ countsTowardAum: true })],
      [
        {
          targetKind: "account",
          opType: "edit",
          targetId: "a1",
          payload: { turnoverPct: { from: null, to: "0.05" } },
        },
      ],
    );
    expect(map.get("a1")!.countsTowardAum).toBe(true);
  });

  it("defaults countsTowardAum to false for a scenario-added account", () => {
    const map = overlayAccountMeta(
      [],
      [
        {
          targetKind: "account",
          opType: "add",
          targetId: "a2",
          payload: { growthSource: "default" },
        },
      ],
    );
    expect(map.get("a2")!.countsTowardAum).toBe(false);
  });

  it("overlays countsTowardAum: false as a real boolean, not the truthy string \"false\"", () => {
    const map = overlayAccountMeta(
      [baseRow({ countsTowardAum: true })],
      [
        {
          targetKind: "account",
          opType: "edit",
          targetId: "a1",
          payload: { countsTowardAum: { from: true, to: false } },
        },
      ],
    );
    expect(map.get("a1")!.countsTowardAum).toBe(false);
  });

  it("coerces the JSON string \"false\" payload value to the boolean false", () => {
    const map = overlayAccountMeta(
      [baseRow({ countsTowardAum: true })],
      [
        {
          targetKind: "account",
          opType: "edit",
          targetId: "a1",
          payload: { countsTowardAum: { from: true, to: "false" } },
        },
      ],
    );
    expect(map.get("a1")!.countsTowardAum).toBe(false);
  });

  it("overlays a scenario edit of a business's notes", () => {
    const map = overlayAccountMeta([baseRow({ notes: "old" })], [
      {
        targetKind: "account",
        opType: "edit",
        targetId: "a1",
        payload: { notes: { from: "old", to: "new" } },
      },
    ]);
    expect(map.get("a1")!.notes).toBe("new");
  });

  it("carries a scenario-added account's notes", () => {
    const map = overlayAccountMeta([], [
      { targetKind: "account", opType: "add", targetId: "n1", payload: { id: "n1", notes: "hello" } },
    ]);
    expect(map.get("n1")!.notes).toBe("hello");
  });

  it("overlays the stored growth rate, so Edit Business opens on the scenario's rate", () => {
    const map = overlayAccountMeta([baseRow({ id: "b1", growthRate: "0.0800" }), baseRow({ id: "b2" })], [
      { targetKind: "account", opType: "edit", targetId: "b1", payload: { growthRate: { from: 0.08, to: null } } },
      { targetKind: "account", opType: "edit", targetId: "b2", payload: { growthRate: { from: 0.05, to: 0.11 } } },
      { targetKind: "account", opType: "add", targetId: "b3", payload: { id: "b3", growthRate: 0.07 } },
    ]);
    expect(map.get("b1")!.growthRate).toBeNull();
    expect(map.get("b2")!.growthRate).toBe("0.11");
    expect(map.get("b3")!.growthRate).toBe("0.07");
  });
});
