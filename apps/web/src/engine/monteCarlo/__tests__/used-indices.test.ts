import { describe, it, expect } from "vitest";
import { detectUsedAssetClassIds } from "../used-indices";
import type { AccountAssetMix } from "../trial";

describe("detectUsedAssetClassIds", () => {
  it("returns the union of asset-class ids referenced across all account mixes", () => {
    const mixes = new Map<string, AccountAssetMix[]>([
      ["acct1", [{ assetClassId: "lc", weight: 0.6 }, { assetClassId: "bd", weight: 0.4 }]],
      ["acct2", [{ assetClassId: "mc", weight: 1.0 }]],
      ["acct3", [{ assetClassId: "lc", weight: 0.5 }, { assetClassId: "bd", weight: 0.5 }]],
    ]);
    const out = detectUsedAssetClassIds(mixes);
    expect(out.sort()).toEqual(["bd", "lc", "mc"]);
  });

  it("returns an empty array when no accounts have mixes", () => {
    expect(detectUsedAssetClassIds(new Map())).toEqual([]);
  });

  it("adds the optional inflation class when requested", () => {
    const mixes = new Map<string, AccountAssetMix[]>([
      ["acct1", [{ assetClassId: "lc", weight: 1.0 }]],
    ]);
    const out = detectUsedAssetClassIds(mixes, { inflationAssetClassId: "cpi" });
    expect(out.sort()).toEqual(["cpi", "lc"]);
  });

  it("does not duplicate the inflation class if already referenced by a mix", () => {
    const mixes = new Map<string, AccountAssetMix[]>([
      ["acct1", [{ assetClassId: "cpi", weight: 1.0 }]],
    ]);
    const out = detectUsedAssetClassIds(mixes, { inflationAssetClassId: "cpi" });
    expect(out).toEqual(["cpi"]);
  });

  it("ignores zero-weight entries (an account can reference a class but not hold it)", () => {
    const mixes = new Map<string, AccountAssetMix[]>([
      ["acct1", [{ assetClassId: "lc", weight: 1.0 }, { assetClassId: "bd", weight: 0 }]],
    ]);
    const out = detectUsedAssetClassIds(mixes);
    expect(out).toEqual(["lc"]);
  });
});
