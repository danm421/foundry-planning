import { describe, it, expect } from "vitest";
import { emptySellLeg, emptyBuyLeg } from "../asset-transaction-leg-model";
import { legToBody, combinedNet, mergeEditBody } from "../use-asset-transaction-legs";
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
  it("full sale persists a typed value/basis override (engine honors saleValue override)", () => {
    const leg = { ...mkSell("s"), sellAccountId: "acc-1",
      overrideSaleValue: "850000", overrideBasis: "600000" };
    const body = legToBody(leg, 2030, { isRealEstate: false });
    expect(body.fractionSold).toBeNull();
    expect(body.overrideSaleValue).toBe("850000");
    expect(body.overrideBasis).toBe("600000");
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

describe("legToBody — buy property tax", () => {
  it("sends all three when the advisor typed an amount on a real-estate buy", () => {
    const leg = { ...mkBuy("b"), assetName: "Condo", purchasePrice: "800000",
      annualPropertyTax: "16500", propertyTaxGrowthRate: "3",
      propertyTaxGrowthSource: "custom" as const };
    const body = legToBody(leg, 2030, { isRealEstate: true });
    expect(body.annualPropertyTax).toBe("16500");
    expect(body.propertyTaxGrowthRate).toBe("0.03");   // percent → decimal string
    expect(body.propertyTaxGrowthSource).toBe("custom");
  });

  // The growth rate defaults to "3" on every buy leg, so gating it on the
  // CATEGORY alone stamped a phantom 0.0300 onto rows the advisor never gave
  // an amount — including, through the UPDATE path, pre-feature rows whose
  // columns were NULL. All three gate on the amount, like the source already did.
  it("sends no growth rate when the amount is blank, even on real estate", () => {
    const leg = { ...mkBuy("b"), assetName: "Condo", purchasePrice: "800000",
      annualPropertyTax: "" };
    const body = legToBody(leg, 2030, { isRealEstate: true });
    expect(body.annualPropertyTax).toBeNull();
    expect(body.propertyTaxGrowthRate).toBeNull();
    expect(body.propertyTaxGrowthSource).toBeNull();
  });

  it("sends nothing for a non-real-estate buy that carries an amount", () => {
    const leg = { ...mkBuy("b"), assetCategory: "taxable" as const, assetSubType: "brokerage",
      annualPropertyTax: "16500", propertyTaxGrowthRate: "3" };
    const body = legToBody(leg, 2030, { isRealEstate: false });
    expect(body.annualPropertyTax).toBeNull();
    expect(body.propertyTaxGrowthRate).toBeNull();
    expect(body.propertyTaxGrowthSource).toBeNull();
  });
});

describe("mergeEditBody", () => {
  // A legacy "swap" record holds sell fields AND buy fields on one row, so
  // legsFromInitialData yields two legs and the merged body is typed "sell".
  // The DB CHECK (asset_transactions_buy_only_property_tax_check) forbids all
  // three property-tax columns on a sell row, so the buy leg's values must not
  // survive the merge: in base mode the route 422s, and in scenario mode the
  // change is stored unvalidated and blows up the whole promote as a raw
  // Postgres error.
  it("nulls all three property-tax fields when a sell leg is present", () => {
    const sell = { ...mkSell("s"), name: "Sell 45 Oak", sellAccountId: "acc-1" };
    const buy = { ...mkBuy("b"), name: "Buy Condo", assetName: "Condo",
      assetCategory: "real_estate" as const, purchasePrice: "800000",
      annualPropertyTax: "16500", propertyTaxGrowthRate: "3",
      propertyTaxGrowthSource: "custom" as const };
    const body = mergeEditBody([sell, buy], "Downsize 2030", 2030, { isRealEstate: true });
    expect(body.type).toBe("sell");
    expect(body.assetName).toBe("Condo");        // the buy side is still merged
    expect(body.annualPropertyTax).toBeNull();
    expect(body.propertyTaxGrowthRate).toBeNull();
    expect(body.propertyTaxGrowthSource).toBeNull();
  });

  it("keeps all three on a buy-only record", () => {
    const buy = { ...mkBuy("b"), name: "Buy Condo", assetName: "Condo",
      assetCategory: "real_estate" as const, purchasePrice: "800000",
      annualPropertyTax: "16500", propertyTaxGrowthRate: "3",
      propertyTaxGrowthSource: "custom" as const };
    const body = mergeEditBody([buy], "Buy a condo", 2030, { isRealEstate: true });
    expect(body.type).toBe("buy");
    expect(body.annualPropertyTax).toBe("16500");
    expect(body.propertyTaxGrowthRate).toBe("0.03");
    expect(body.propertyTaxGrowthSource).toBe("custom");
  });
});
