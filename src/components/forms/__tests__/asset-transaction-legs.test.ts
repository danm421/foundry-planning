import { describe, it, expect } from "vitest";
import { emptySellLeg, emptyBuyLeg } from "../asset-transaction-leg-model";
import { legToBody, combinedNet } from "../use-asset-transaction-legs";
import { emptySellLeg as mkSell, emptyBuyLeg as mkBuy } from "../asset-transaction-leg-model";

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

describe("legToBody — sell", () => {
  it("account full sale nulls fraction + overrideSaleValue and applies §121 only for real estate", () => {
    const leg = { ...mkSell("s"), name: "Sell A", sellAccountId: "acc-1",
      qualifiesForHomeSaleExclusion: true, transactionCostPct: "6", transactionCostFlat: "1000" };
    const body = legToBody(leg, 2030, { isRealEstate: true });
    expect(body.type).toBe("sell");
    expect(body.name).toBe("Sell A");
    expect(body.year).toBe(2030);
    expect(body.accountId).toBe("acc-1");
    expect(body.fractionSold).toBeNull();
    expect(body.overrideSaleValue).toBeNull();
    expect(body.transactionCostPct).toBe("0.06");   // percent → decimal string
    expect(body.transactionCostFlat).toBe("1000");
    expect(body.qualifiesForHomeSaleExclusion).toBe(true);
  });
  it("non-real-estate never persists §121 true", () => {
    const leg = { ...mkSell("s"), sellAccountId: "acc-1", qualifiesForHomeSaleExclusion: true };
    const body = legToBody(leg, 2030, { isRealEstate: false });
    expect(body.qualifiesForHomeSaleExclusion).toBe(false);
  });
  it("percent sale sends fractionSold decimal, no overrideSaleValue", () => {
    const leg = { ...mkSell("s"), sellAccountId: "acc-1", sellAmountMode: "percent" as const, fractionSoldPct: "25" };
    const body = legToBody(leg, 2030, { isRealEstate: false });
    expect(body.fractionSold).toBe(0.25);
    expect(body.overrideSaleValue).toBeNull();
  });
  it("business sale clears account sources and forces §121 false", () => {
    const leg = { ...mkSell("s"), sellMode: "business" as const, sellBusinessAccountId: "biz-1",
      sellAmountMode: "percent" as const, fractionSoldPct: "50" };
    const body = legToBody(leg, 2030, { isRealEstate: false });
    expect(body.accountId).toBeNull();
    expect(body.businessAccountId).toBe("biz-1");
    expect(body.fractionSold).toBe(0.5);
    expect(body.qualifiesForHomeSaleExclusion).toBe(false);
  });
});

describe("legToBody — buy", () => {
  it("maps buy fields; mortgage nulled when hidden; 'from sale proceeds' → null funding", () => {
    const leg = { ...mkBuy("b"), name: "Buy Condo", assetName: "Condo",
      assetCategory: "real_estate" as const, assetSubType: "primary_residence",
      purchasePrice: "800000", growthRate: "3.5", fundingAccountId: "__from_sale_proceeds__" };
    const body = legToBody(leg, 2030, { isRealEstate: false });
    expect(body.type).toBe("buy");
    expect(body.assetName).toBe("Condo");
    expect(body.purchasePrice).toBe("800000");
    expect(body.growthRate).toBe("0.035");
    expect(body.fundingAccountId).toBeNull();
    expect(body.mortgageAmount).toBeNull();
  });
  it("includes mortgage fields when showMortgage is true", () => {
    const leg = { ...mkBuy("b"), assetName: "Condo", purchasePrice: "800000",
      showMortgage: true, mortgageAmount: "500000", mortgageRate: "6.75", mortgageTermMonths: "360" };
    const body = legToBody(leg, 2030, { isRealEstate: false });
    expect(body.mortgageAmount).toBe("500000");
    expect(body.mortgageRate).toBe("0.0675");
    expect(body.mortgageTermMonths).toBe(360);
  });
});

describe("combinedNet", () => {
  it("sums proceeds and purchases", () => {
    expect(combinedNet([420000, 300000], [800000]))
      .toEqual({ proceeds: 720000, purchases: 800000, net: -80000 });
  });
});
