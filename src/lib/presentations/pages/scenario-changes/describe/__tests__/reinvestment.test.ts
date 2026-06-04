import { it, expect } from "vitest";
import { describeChange } from "../index";
import { buildResolveContext } from "../resolve";

it("reinvestment add (model portfolio): scope, prior allocation, new model + rate, taxes", () => {
  const resolve = buildResolveContext({
    accountsById: { acc: { name: "Brokerage", category: "taxable" } },
    recipientsById: {}, entitiesById: {}, spouseName: null,
    modelPortfoliosById: { mp: { name: "Growth 70/30", rate: 0.065 } },
    baseAllocationsById: { acc: { mix: "80/20 stock/bond", blendedRate: 0.072 } },
  });
  const row = describeChange({ id: "c", scenarioId: "s", opType: "add", targetKind: "reinvestment",
    targetId: "ri", toggleGroupId: null, orderIndex: 0,
    payload: { accountIds: ["acc"], groupKeys: [], year: 2030, targetType: "model_portfolio",
      modelPortfolioId: "mp", realizeTaxesOnSwitch: true },
  }, { targetNames: {}, resolve });
  const d = row.detail.join(" | ");
  expect(row.area).toBe("Savings");
  expect(d).toContain("2030"); expect(d).toContain("Brokerage");
  expect(d).toContain("80/20"); expect(d).toContain("Growth 70/30"); expect(d).toContain("6.5%");
  expect(d.toLowerCase()).toContain("tax");
});

it("reinvestment add (custom): uses customGrowthRate (string), not newGrowthRate", () => {
  const resolve = buildResolveContext({
    accountsById: { acc: { name: "Brokerage", category: "taxable" } },
    recipientsById: {}, entitiesById: {}, spouseName: null,
    modelPortfoliosById: {}, baseAllocationsById: {},
  });
  const row = describeChange({ id: "c", scenarioId: "s", opType: "add", targetKind: "reinvestment",
    targetId: "ri", toggleGroupId: null, orderIndex: 0,
    payload: { accountIds: ["acc"], groupKeys: [], year: 2031, targetType: "custom",
      modelPortfolioId: null, customGrowthRate: "0.0600", realizeTaxesOnSwitch: false },
  }, { targetNames: {}, resolve });
  const d = row.detail.join(" | ");
  expect(d).toContain("6%");            // 0.0600 → 6%
  expect(d.toLowerCase()).toContain("custom");
  expect(d.toLowerCase()).toContain("tax"); // "Tax-deferred switch"
});
