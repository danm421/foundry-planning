// src/lib/whatif/__tests__/translate-techniques.test.ts
import { describe, it, expect } from "vitest";
import { translateChanges } from "../translate";
import type { WhatIfChange } from "../changes";
import { IDS, whatIfTree } from "./fixtures";

const NEW = "00000000-0000-4000-8000-0000000000aa";
const run = (changes: WhatIfChange[], tree = whatIfTree()) => translateChanges(tree, changes, () => NEW);

/** The fixture's 401k and Roth have different owners (client vs spouse); give
 *  the Roth to the client so a valid conversion exists. */
function treeWithClientRoth() {
  const tree = whatIfTree();
  const clientFm = tree.familyMembers!.find((f) => f.role === "client")!.id;
  tree.accounts = tree.accounts.map((a) =>
    a.id === IDS.roth
      ? { ...a, owners: [{ kind: "family_member" as const, familyMemberId: clientFm, percent: 1 }] }
      : a,
  );
  return tree;
}

describe("roth_conversion", () => {
  const base = {
    type: "roth_conversion" as const,
    fromAccountIds: [IDS.k401],
    toAccountId: IDS.roth,
    startYear: 2027,
    endYear: 2032,
  };

  it("builds a bracket-fill conversion record", () => {
    const out = run([{ ...base, mode: "fill_bracket", bracket: 0.24 }], treeWithClientRoth());
    expect(out.recordIds).toEqual([NEW]);
    expect(out.mutations).toHaveLength(1);
    const m = out.mutations[0];
    if (m.kind !== "roth-conversion-upsert" || !m.value) throw new Error("wrong mutation");
    expect(m.value).toMatchObject({
      id: NEW,
      destinationAccountId: IDS.roth,
      sourceAccountIds: [IDS.k401],
      conversionType: "fill_up_bracket",
      fillUpBracket: 0.24,
      fixedAmount: 0,
      startYear: 2027,
      endYear: 2032,
      indexingRate: 0,
      irmaaCapTier: null,
      enabled: true,
    });
  });

  it("refuses a cash account as the destination", () => {
    expect(() => run([{ ...base, toAccountId: IDS.savings, mode: "fill_bracket", bracket: 0.24 }])).toThrow(
      /isn't a Roth IRA/,
    );
  });

  it("refuses a non-pre-tax source", () => {
    expect(() =>
      run([{ ...base, fromAccountIds: [IDS.brokerage], mode: "fill_bracket", bracket: 0.24 }], treeWithClientRoth()),
    ).toThrow(/isn't a pre-tax retirement account/);
  });

  it("refuses accounts with different owners", () => {
    expect(() => run([{ ...base, mode: "fill_bracket", bracket: 0.24 }])).toThrow(/have different owners/);
  });

  it("needs an amount for fixed_amount and a real bracket for fill_bracket", () => {
    expect(() => run([{ ...base, mode: "fixed_amount" }], treeWithClientRoth())).toThrow(/fixed_amount needs an amount/);
    expect(() => run([{ ...base, mode: "fill_bracket", bracket: 0.25 }], treeWithClientRoth())).toThrow(
      /fill_bracket needs bracket/,
    );
  });

  it("refuses a source id from another household", () => {
    expect(() =>
      run([{ ...base, fromAccountIds: [IDS.foreign], mode: "full_account" }], treeWithClientRoth()),
    ).toThrow(/account .* isn't in this plan/);
  });
});

describe("asset_sale and asset_purchase", () => {
  it("sells part of an account", () => {
    const out = run([{ type: "asset_sale", accountId: IDS.brokerage, year: 2030, fraction: 0.5 }]);
    const m = out.mutations[0];
    if (m.kind !== "asset-transaction-upsert" || !m.value) throw new Error("wrong mutation");
    expect(m.value).toMatchObject({ type: "sell", year: 2030, accountId: IDS.brokerage, fractionSold: 0.5 });
  });

  it("refuses to sell a retirement account", () => {
    expect(() => run([{ type: "asset_sale", accountId: IDS.k401, year: 2030 }])).toThrow(/can't be sold/);
  });

  it("buys a rental with a mortgage, and needs a rate with a mortgage", () => {
    const out = run([
      {
        type: "asset_purchase",
        name: "Beach rental",
        propertyType: "rental_property",
        year: 2028,
        purchasePrice: 600_000,
        mortgageAmount: 400_000,
        mortgageRate: 0.065,
      },
    ]);
    const m = out.mutations[0];
    if (m.kind !== "asset-transaction-upsert" || !m.value) throw new Error("wrong mutation");
    expect(m.value).toMatchObject({
      type: "buy",
      assetCategory: "real_estate",
      assetSubType: "rental_property",
      purchasePrice: 600_000,
      basis: 600_000,
      mortgageAmount: 400_000,
      mortgageRate: 0.065,
      mortgageTermMonths: 360,
    });
    expect(() =>
      run([
        { type: "asset_purchase", name: "x", propertyType: "rental_property", year: 2028, purchasePrice: 1, mortgageAmount: 1 },
      ]),
    ).toThrow(/mortgageRate is required/);
  });
});

describe("gift", () => {
  it("makes a one-time gift to a child", () => {
    const out = run([{ type: "gift", familyMemberId: IDS.child, grantor: "joint", amount: 19_000, startYear: 2027 }]);
    const m = out.mutations[0];
    if (m.kind !== "gift-upsert" || !m.value) throw new Error("wrong mutation");
    expect(m.value).toMatchObject({ kind: "cash-once", year: 2027, amount: 19_000, recipient: { kind: "family_member", id: IDS.child } });
  });

  it("makes a yearly gift series to a charity", () => {
    const out = run([
      { type: "gift", charityId: IDS.charity, grantor: "client", amount: 10_000, startYear: 2027, endYear: 2035 },
    ]);
    const m = out.mutations[0];
    if (m.kind !== "gift-upsert" || !m.value) throw new Error("wrong mutation");
    expect(m.value).toMatchObject({ kind: "series", startYear: 2027, endYear: 2035, amountMode: "fixed" });
  });

  it("refuses a gift to the spouse, and needs exactly one recipient", () => {
    const spouseId = whatIfTree().familyMembers!.find((f) => f.role === "spouse")!.id;
    expect(() => run([{ type: "gift", familyMemberId: spouseId, grantor: "client", amount: 1, startYear: 2027 }])).toThrow(
      /someone other than the client or spouse/,
    );
    expect(() => run([{ type: "gift", grantor: "client", amount: 1, startYear: 2027 }])).toThrow(/exactly one of/);
  });
});

describe("relocation, pay_off_debt, add_*, remove", () => {
  it("moves to Florida", () => {
    const m = run([{ type: "relocation", year: 2030, state: "FL" }]).mutations[0];
    expect(m).toMatchObject({ kind: "relocation-upsert", value: { year: 2030, destinationState: "FL" } });
  });

  it("pays a lump sum on the mortgage, ending the same year", () => {
    const m = run([
      { type: "pay_off_debt", liabilityId: IDS.mortgage, frequency: "one_time", amount: 1_000_000, startYear: 2030, endYear: 2040 },
    ]).mutations[0];
    expect(m).toEqual({
      kind: "debt-paydown",
      liabilityId: IDS.mortgage,
      value: { liabilityId: IDS.mortgage, frequency: "one_time", amount: 1_000_000, startYear: 2030, endYear: 2030, enabled: true },
    });
  });

  it("adds an income that grows with inflation by default", () => {
    const m = run([
      { type: "add_income", name: "Consulting", owner: "client", annualAmount: 50_000, startYear: 2031, endYear: 2035 },
    ]).mutations[0];
    if (m.kind !== "income-upsert" || !m.value) throw new Error("wrong mutation");
    expect(m.value).toMatchObject({
      id: NEW,
      name: "Consulting",
      owner: "client",
      annualAmount: 50_000,
      growthSource: "inflation",
      growthRate: whatIfTree().planSettings.inflationRate,
    });
  });

  it("adds a Roth IRA with savings until the owner's retirement year", () => {
    const out = run([{ type: "add_account", accountType: "roth_ira", owner: "client", balance: 10_000, annualSavings: 7_000 }]);
    expect(out.mutations.map((m) => m.kind)).toEqual(["account-upsert", "savings-rule-upsert"]);
    const rule = out.mutations[1];
    if (rule.kind !== "savings-rule-upsert" || !rule.value) throw new Error("wrong mutation");
    // Fixture client: born 1970, retires at 65 → 2035.
    expect(rule.value).toMatchObject({ annualAmount: 7_000, startYear: 2026, endYear: 2035 });
  });

  it("adds an account with no savings rule when there are no savings", () => {
    const out = run([{ type: "add_account", accountType: "taxable", owner: "spouse", balance: 50_000 }]);
    expect(out.mutations.map((m) => m.kind)).toEqual(["account-upsert"]);
  });

  it("grows a new account at the plan default, as the Solver's quick-add does, unless given a rate", () => {
    const growthSource = (growthRate?: number) => {
      const m = run([{ type: "add_account", accountType: "taxable", owner: "client", balance: 1, growthRate }]).mutations[0];
      if (m.kind !== "account-upsert" || !m.value) throw new Error("wrong mutation");
      return { source: m.value.growthSource, rate: m.value.growthRate };
    };
    expect(growthSource()).toMatchObject({ source: "default" });
    expect(growthSource(0.05)).toEqual({ source: "custom", rate: 0.05 });
  });

  it("removes an existing expense and refuses an unknown one", () => {
    expect(run([{ type: "remove", kind: "expense", id: IDS.insurance }]).mutations).toEqual([
      { kind: "expense-upsert", id: IDS.insurance, value: null },
    ]);
    expect(() => run([{ type: "remove", kind: "liability", id: IDS.foreign }])).toThrow(/isn't in this plan/);
  });
});

describe("resolved growth defaults", () => {
  // Raw plan-settings columns that differ from the resolved defaults, so a pass
  // proves the resolved rate wins over the column, not just over a fallback.
  function treeWithRawDefaults() {
    const tree = whatIfTree();
    tree.planSettings = {
      ...tree.planSettings,
      defaultGrowthTaxable: 0.09,
      defaultGrowthRetirement: 0.08,
      defaultGrowthCash: 0.05,
      defaultGrowthRealEstate: 0.07,
    };
    return tree;
  }
  const growthDefaults = { taxable: 0.061, retirement: 0.062, cash: 0.021, realEstate: 0.034 };
  const purchase: WhatIfChange = {
    type: "asset_purchase",
    name: "Cabin",
    propertyType: "primary_residence",
    year: 2028,
    purchasePrice: 300_000,
  };
  const rateOf = (m: ReturnType<typeof run>["mutations"][number]) => {
    if (m.kind === "account-upsert" && m.value) return m.value.growthRate;
    if (m.kind === "asset-transaction-upsert" && m.value) return m.value.growthRate;
    throw new Error("wrong mutation");
  };
  const translate = (change: WhatIfChange, withDefaults: boolean) =>
    rateOf(
      translateChanges(treeWithRawDefaults(), [change], () => NEW, withDefaults ? { growthDefaults } : undefined)
        .mutations[0],
    );
  const account = (accountType: "taxable" | "ira" | "roth_ira" | "cash", growthRate?: number): WhatIfChange => ({
    type: "add_account",
    accountType,
    owner: "client",
    balance: 1,
    growthRate,
  });

  it("uses the passed-in category default over the raw plan-settings column", () => {
    expect(translate(account("taxable"), true)).toBe(0.061);
    expect(translate(account("ira"), true)).toBe(0.062);
    expect(translate(account("roth_ira"), true)).toBe(0.062);
    expect(translate(account("cash"), true)).toBe(0.021);
    expect(translate(purchase, true)).toBe(0.034);
  });

  it("falls back to the raw column without them, and an explicit rate beats both", () => {
    expect(translate(account("taxable"), false)).toBe(0.09);
    expect(translate(account("ira"), false)).toBe(0.08);
    expect(translate(account("cash"), false)).toBe(0.05);
    expect(translate(purchase, false)).toBe(0.07);
    expect(translate(account("taxable", 0.04), true)).toBe(0.04);
    expect(translate({ ...purchase, growthRate: 0.04 }, true)).toBe(0.04);
  });
});

// Review Focus 1: every id the model supplies is looked up in THIS household's
// tree before a mutation is built. One row per id-bearing field.
describe("an id from another household", () => {
  const F = IDS.foreign;
  const refused = (what: string) => new RegExp(`^Change 1: ${what} ${F} isn't in this plan`);
  const roth = { type: "roth_conversion" as const, mode: "full_account" as const, startYear: 2027 };
  const purchase = {
    type: "asset_purchase" as const,
    name: "Cabin",
    propertyType: "primary_residence" as const,
    year: 2028,
    purchasePrice: 300_000,
  };
  const cases: Array<[string, WhatIfChange, RegExp]> = [
    ["roth_conversion toAccountId", { ...roth, fromAccountIds: [IDS.k401], toAccountId: F }, refused("account")],
    ["roth_conversion fromAccountIds", { ...roth, fromAccountIds: [IDS.k401, F], toAccountId: IDS.roth }, refused("account")],
    ["asset_sale accountId", { type: "asset_sale", accountId: F, year: 2030 }, refused("account")],
    [
      "asset_sale proceedsAccountId",
      { type: "asset_sale", accountId: IDS.brokerage, year: 2030, proceedsAccountId: F },
      refused("account"),
    ],
    ["asset_purchase fundingAccountId", { ...purchase, fundingAccountId: F }, refused("account")],
    [
      "gift familyMemberId",
      { type: "gift", familyMemberId: F, grantor: "client", amount: 1, startYear: 2027 },
      refused("family member"),
    ],
    ["gift charityId", { type: "gift", charityId: F, grantor: "client", amount: 1, startYear: 2027 }, refused("charity")],
    [
      "gift charityId naming a family member",
      { type: "gift", charityId: IDS.child, grantor: "client", amount: 1, startYear: 2027 },
      new RegExp(`^Change 1: charity ${IDS.child} isn't in this plan`),
    ],
    [
      "pay_off_debt liabilityId",
      { type: "pay_off_debt", liabilityId: F, frequency: "annual", amount: 1, startYear: 2030 },
      refused("liability"),
    ],
    ["remove income", { type: "remove", kind: "income", id: F }, refused("income")],
    ["remove expense", { type: "remove", kind: "expense", id: F }, refused("expense")],
    ["remove account", { type: "remove", kind: "account", id: F }, refused("account")],
    ["remove liability", { type: "remove", kind: "liability", id: F }, refused("liability")],
    ["remove roth_conversion", { type: "remove", kind: "roth_conversion", id: F }, refused("roth conversion")],
    ["remove asset_transaction", { type: "remove", kind: "asset_transaction", id: F }, refused("asset transaction")],
    [
      "remove naming a record of another kind",
      { type: "remove", kind: "income", id: IDS.insurance },
      new RegExp(`^Change 1: income ${IDS.insurance} isn't in this plan`),
    ],
  ];

  it.each(cases)("refuses a foreign %s", (_field, change, message) => {
    expect(() => run([change], treeWithClientRoth())).toThrow(message);
  });
});
