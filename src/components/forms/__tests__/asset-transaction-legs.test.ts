import { describe, it, expect } from "vitest";
import { emptySellLeg, emptyBuyLeg } from "../asset-transaction-leg-model";

describe("leg factories", () => {
  it("emptySellLeg defaults to a full-sale account source", () => {
    const leg = emptySellLeg("k1");
    expect(leg.kind).toBe("sell");
    expect(leg.sellMode).toBe("account");
    expect(leg.sellAmountMode).toBe("full");
    expect(leg.fractionSoldPct).toBe("100");
  });
  it("emptyBuyLeg defaults to real_estate + first sub-type", () => {
    const leg = emptyBuyLeg("k2");
    expect(leg.kind).toBe("buy");
    expect(leg.assetCategory).toBe("real_estate");
    expect(leg.assetSubType).toBe("primary_residence");
  });
});
