import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { buildPlanInventory } from "../plan-inventory";
import { DETAIL_GROUP_ORDER, detailType } from "../plan-detail-catalog";

const tree = {
  client: { firstName: "Pat", lastName: "Lee" },
  accounts: [
    { id: "a-tax", name: "Brokerage", category: "taxable" },
    { id: "a-chk", name: "Checking", category: "cash", isDefaultChecking: true },
    { id: "entity-checking-e1", name: "Trust cash", category: "cash" },
    { id: "a-biz", name: "Acme", category: "business", parentAccountId: null },
    { id: "a-bizchild", name: "Acme sub", category: "business", parentAccountId: "a-biz" },
    { id: "a-life", name: "Term life", category: "life_insurance" },
  ],
  incomes: [
    { id: "i-sal", name: "Salary", type: "salary", owner: "client" },
    { id: "i-ss-c", name: "SS Pat", type: "social_security", owner: "client" },
    { id: "i-ss-s", name: "SS Sam", type: "social_security", owner: "spouse" },
    { id: "policy-income-x", name: "Policy", type: "other", owner: "client", source: "policy" },
  ],
  expenses: [
    { id: "x-live", name: "Living", type: "living", isDefault: true },
    { id: "x-trip", name: "Trips", type: "other" },
    { id: "premium-x", name: "Premium", type: "insurance", source: "policy" },
  ],
  liabilities: [{ id: "l1", name: "Mortgage" }],
  savingsRules: [{ id: "r1", accountId: "a-tax", annualAmount: 6000 }],
  notesReceivable: [{ id: "n1", name: "Note to Sam" }],
  disabilityPolicies: [{ id: "d1", name: "LTD" }],
  entities: [
    { id: "t1", name: "Family Trust", entityType: "trust" },
    { id: "e2", name: "Acme LLC", entityType: "llc" },
  ],
  wills: [{ id: "w1", grantor: "client", bequests: [] }],
  familyMembers: [
    { id: "f-c", role: "client", firstName: "Pat", lastName: "Lee" },
    { id: "f-s", role: "spouse", firstName: "Sam", lastName: "Lee" },
    { id: "f-k", role: "child", firstName: "Kim", lastName: "Lee" },
  ],
  externalBeneficiaries: [{ id: "b1", name: "Red Cross", kind: "charity", charityType: "public" }],
  rothConversions: [{ id: "rc1", name: "Roth 2030" }],
  relocations: [{ id: "rl1", name: "Move to FL" }],
  transfers: [{ id: "tr1", name: "Sweep" }],
  reinvestments: [{ id: "rv1", name: "De-risk" }],
  assetTransactions: [
    { id: "s1", name: "Move — Sell House", type: "sell", year: 2030, bundleId: "B1" },
    { id: "b1", name: "Move — Buy Condo", type: "buy", year: 2030, bundleId: "B1" },
    { id: "solo", name: "Sell stock", type: "sell", year: 2031 },
  ],
  deductions: [
    { id: "dd1", type: "charitable", annualAmount: 5000, growthRate: 0, startYear: 2026, endYear: 2030 },
    { type: "above_line", annualAmount: 1, growthRate: 0, startYear: 2026, endYear: 2030 },
  ],
  taxAdjustments: [{ id: "ta1", name: "Prior bonus", annualAmount: 100 }],
} as unknown as ClientData;

const gifts = [
  { kind: "cash-once", id: "g1", year: 2030, amount: 10, grantor: "client", recipient: { kind: "external_beneficiary", id: "b1" }, crummey: false },
  { kind: "series", id: "g2", startYear: 2028, endYear: 2032, annualAmount: 1, amountMode: "fixed", inflationAdjust: false, grantor: "client", recipient: { kind: "entity", id: "t1" }, crummey: false },
] as unknown as EstateFlowGift[];

const items = buildPlanInventory(tree, gifts, "client-1");
const byType = (k: string) => items.filter((i) => i.typeKey === k);
const ids = (k: string) => byType(k).map((i) => i.id);

describe("buildPlanInventory", () => {
  it("drops synthesized policy rows and entity checking accounts", () => {
    const all = items.map((i) => i.id);
    expect(all).not.toContain("premium-x");
    expect(all).not.toContain("policy-income-x");
    expect(all).not.toContain("entity-checking-e1");
  });

  it("locks delete on the default checking and default living rows", () => {
    expect(byType("account").find((i) => i.id === "a-chk")).toMatchObject({ canEdit: true, canDelete: false });
    expect(byType("expense").find((i) => i.id === "x-live")).toMatchObject({ canEdit: true, canDelete: false });
    expect(byType("expense").find((i) => i.id === "x-trip")).toMatchObject({ canDelete: true });
  });

  it("lists Social Security as one edit-only item per person", () => {
    const ss = byType("social_security");
    expect(ss.map((i) => i.draftRef?.person).sort()).toEqual(["client", "spouse"]);
    for (const i of ss) expect(i).toMatchObject({ canEdit: true, canDelete: false });
    expect(ids("income")).toEqual(["i-sal"]);
  });

  it("splits business, life-insurance and ordinary accounts", () => {
    expect(ids("business")).toEqual(["a-biz"]);
    expect(ids("life_policy")).toEqual(["a-life"]);
    expect(ids("account").sort()).toEqual(["a-bizchild", "a-chk", "a-tax"]);
  });

  it("always includes client info and the three assumptions singletons", () => {
    expect(byType("client_info")[0]).toMatchObject({ id: "client-1", canDelete: false });
    expect(ids("tax_rates")).toEqual(["tax-rates"]);
    expect(ids("growth_inflation")).toEqual(["growth-inflation"]);
    expect(ids("savings_withdrawals")).toEqual(["withdrawal"]);
  });

  it("turns the gift list into gift / gift_series items", () => {
    expect(byType("gift")[0]).toMatchObject({ id: "g1", label: "Gift to Red Cross · 2030" });
    expect(byType("gift_series")[0]).toMatchObject({
      id: "g2",
      label: "Recurring gift to Family Trust · 2028–2032",
    });
  });

  it("lists every entity under trust, not only trusts", () => {
    expect(ids("trust").sort()).toEqual(["e2", "t1"]);
  });

  it("lists family members other than the household principals", () => {
    expect(ids("family_member")).toEqual(["f-k"]);
  });

  it("lists savings rules with the account in draftRef", () => {
    expect(byType("savings_rule")[0]).toMatchObject({
      id: "r1",
      label: "Brokerage · $6k/yr",
      draftRef: { accountId: "a-tax" },
    });
  });

  it("lists one asset-transaction item per leg, bundle name as sublabel", () => {
    const legs = byType("asset_transaction");
    expect(legs.map((i) => i.id).sort()).toEqual(["b1", "s1", "solo"]);
    expect(legs.find((i) => i.id === "s1")?.sublabel).toBe("Move");
    expect(legs.find((i) => i.id === "solo")?.sublabel).toBeUndefined();
  });

  it("skips deduction rows that carry no id", () => {
    expect(ids("deduction")).toEqual(["dd1"]);
  });

  it("maps the remaining families to their own types", () => {
    expect(ids("note_receivable")).toEqual(["n1"]);
    expect(ids("liability")).toEqual(["l1"]);
    expect(ids("disability_policy")).toEqual(["d1"]);
    expect(ids("will")).toEqual(["w1"]);
    expect(ids("external_beneficiary")).toEqual(["b1"]);
    expect(ids("roth_conversion")).toEqual(["rc1"]);
    expect(ids("relocation")).toEqual(["rl1"]);
    expect(ids("transfer")).toEqual(["tr1"]);
    expect(ids("reinvestment")).toEqual(["rv1"]);
    expect(ids("tax_adjustment")).toEqual(["ta1"]);
  });

  it("keys items by type and id, and sorts by group order", () => {
    expect(items.every((i) => i.key === `${i.typeKey}:${i.id}`)).toBe(true);
    const groupIdx = items.map((i) => DETAIL_GROUP_ORDER.indexOf(detailType(i.typeKey).group));
    expect(groupIdx).toEqual([...groupIdx].sort((a, b) => a - b));
  });
});
