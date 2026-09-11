import { describe, it, expect } from "vitest";
import type { AssetTransaction } from "@/engine/types";
import {
  groupAssetTransactionBundles,
  bundleNameFromLegs,
  legLabelFromName,
} from "../asset-transaction-bundles";

const sell = (over: Partial<AssetTransaction> = {}): AssetTransaction =>
  ({ id: "s1", name: "Move house — Sell 45 Oak Ave", type: "sell", year: 2027, accountId: "acc-oak", ...over }) as AssetTransaction;
const buy = (over: Partial<AssetTransaction> = {}): AssetTransaction =>
  ({ id: "b1", name: "Move house — Buy New Wildwood", type: "buy", year: 2027, assetName: "New Wildwood", ...over }) as AssetTransaction;

describe("groupAssetTransactionBundles", () => {
  it("folds legs that share a bundle id into one row", () => {
    const out = groupAssetTransactionBundles([
      sell({ bundleId: "bun-1" }),
      buy({ bundleId: "bun-1" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].legs.map((l) => l.id)).toEqual(["s1", "b1"]);
    expect(out[0].name).toBe("Move house");
    expect(out[0].summary).toBe("Sell 45 Oak Ave + Buy New Wildwood · 2027");
    expect(out[0].enabled).toBe(true);
  });

  it("never groups two un-bundled rows with each other", () => {
    const out = groupAssetTransactionBundles([sell(), buy()]);
    expect(out).toHaveLength(2);
    expect(out.map((b) => b.key)).toEqual(["solo:s1", "solo:b1"]);
  });

  it("leaves a lone row's name and summary exactly as today", () => {
    const out = groupAssetTransactionBundles([
      { id: "s9", name: "Lake house", type: "sell", year: 2032 } as AssetTransaction,
    ]);
    expect(out[0].name).toBe("Lake house");
    expect(out[0].summary).toBe("Sell · Lake house · 2032");
  });

  it("prefers a resolved account name for a sell leg's label", () => {
    const out = groupAssetTransactionBundles(
      [sell({ bundleId: "bun-1" }), buy({ bundleId: "bun-1" })],
      new Map([["acc-oak", "45 Oak Avenue"]]),
    );
    expect(out[0].summary).toBe("Sell 45 Oak Avenue + Buy New Wildwood · 2027");
  });

  it("counts the legs when a bundle has more than two", () => {
    const out = groupAssetTransactionBundles([
      sell({ id: "s1", bundleId: "bun-1" }),
      sell({ id: "s2", bundleId: "bun-1" }),
      buy({ id: "b1", bundleId: "bun-1" }),
    ]);
    expect(out[0].summary).toBe("2 sells + 1 buy · 2027");
  });

  it("reads off when any leg is switched off", () => {
    const out = groupAssetTransactionBundles([
      sell({ bundleId: "bun-1" }),
      buy({ bundleId: "bun-1", enabled: false }),
    ]);
    expect(out[0].enabled).toBe(false);
  });

  it("keeps the order the legs arrived in, by first appearance", () => {
    const out = groupAssetTransactionBundles([
      sell({ id: "solo", bundleId: undefined }),
      sell({ id: "s1", bundleId: "bun-1" }),
      buy({ id: "b1", bundleId: "bun-1" }),
    ]);
    expect(out.map((b) => b.key)).toEqual(["solo:solo", "bundle:bun-1"]);
  });
});

describe("bundleNameFromLegs", () => {
  it("returns the shared prefix", () => {
    expect(bundleNameFromLegs([{ name: "Move house — Sell A" }, { name: "Move house — Buy B" }])).toBe("Move house");
  });
  it("falls back to the first leg's whole name when the prefixes disagree", () => {
    expect(bundleNameFromLegs([{ name: "Move house — Sell A" }, { name: "Something else — Buy B" }])).toBe("Move house — Sell A");
  });
  it("falls back when a leg has no separator at all", () => {
    expect(bundleNameFromLegs([{ name: "Move house — Sell A" }, { name: "Plain" }])).toBe("Move house — Sell A");
  });
});

describe("legLabelFromName", () => {
  it("drops the bundle prefix and the verb", () => {
    expect(legLabelFromName("Move house — Sell 45 Oak Ave")).toBe("45 Oak Ave");
  });
  it("passes a separator-less name through", () => {
    expect(legLabelFromName("Lake house")).toBe("Lake house");
  });
});
