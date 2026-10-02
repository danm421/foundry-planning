import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { buildPlanInventory } from "../plan-inventory";
import { DETAIL_GROUP_ORDER, DETAIL_TYPES, detailType } from "../plan-detail-catalog";

const raw = {
  client: { firstName: "Pat", lastName: "Lee" },
  planSettings: { planStartYear: 2026 },
  accounts: [
    { id: "a-tax", name: "Brokerage", category: "taxable" },
    { id: "a-chk", name: "Checking", category: "cash", isDefaultChecking: true },
    { id: "entity-checking-e1", name: "Trust cash", category: "cash" },
    { id: "a-biz", name: "Acme", category: "business", parentAccountId: null },
    { id: "a-bizchild", name: "Acme sub", category: "business", parentAccountId: "a-biz" },
    { id: "a-life", name: "Term life", category: "life_insurance" },
    { id: "a-note", name: "Legacy note", category: "notes_receivable" },
    { id: "a-bizent", name: "Held by trust", category: "business", owners: [{ kind: "entity", entityId: "t1", percent: 1 }] },
    { id: "a-sub-ok", name: "Acme rental", category: "real_estate", parentAccountId: "a-biz" },
    { id: "a-sub-orphan", name: "Orphan sub", category: "real_estate", parentAccountId: "a-bizent" },
  ],
  incomes: [
    { id: "i-sal", name: "Salary", type: "salary", owner: "client" },
    { id: "i-ss-c", name: "SS Pat", type: "social_security", owner: "client" },
    { id: "i-ss-s", name: "SS Sam", type: "social_security", owner: "spouse" },
    { id: "policy-income-x", name: "Policy", type: "other", owner: "client", source: "policy" },
    { id: "i-ent", name: "Trust income", type: "trust", owner: "client", ownerEntityId: "t1" },
    { id: "i-biz", name: "Biz income", type: "business", owner: "client", ownerAccountId: "a-biz" },
  ],
  expenses: [
    { id: "x-live", name: "Living", type: "living", isDefault: true },
    { id: "x-trip", name: "Trips", type: "other" },
    { id: "premium-x", name: "Premium", type: "insurance", source: "policy" },
    { id: "disability-premium-x", name: "LTD premium", type: "insurance", source: "policy" },
    { id: "x-ent", name: "Trust expense", type: "other", ownerEntityId: "t1" },
    { id: "x-biz", name: "Biz expense", type: "other", ownerAccountId: "a-biz" },
    { id: "x-ret", name: "Retirement living", type: "living", startYear: 2040, endYear: 2060 },
  ],
  liabilities: [
    { id: "l1", name: "Mortgage" },
    { id: "l-ok", name: "Acme loan", parentAccountId: "a-biz" },
    { id: "l-orphan", name: "Orphan loan", parentAccountId: "a-bizent" },
  ],
  savingsRules: [{ id: "r1", accountId: "a-tax", annualAmount: 6000 }],
  notesReceivable: [{ id: "n1", name: "Note to Sam" }],
  disabilityPolicies: [{ id: "d1", name: "LTD" }],
  entities: [
    { id: "t1", name: "Family Trust", entityType: "trust", includeInPortfolio: false, isGrantor: false },
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
};

// Real accounts and liabilities always carry `owners`; default it for brevity.
const tree = {
  ...raw,
  accounts: raw.accounts.map((a) => ({ owners: [], ...a })),
  liabilities: raw.liabilities.map((l) => ({ owners: [], ...l })),
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
    expect(all).not.toContain("disability-premium-x");
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
    expect(ids("business").sort()).toEqual(["a-biz", "a-bizent"]);
    expect(ids("life_policy")).toEqual(["a-life"]);
    expect(ids("account").sort()).toEqual(["a-bizchild", "a-chk", "a-sub-ok", "a-tax"]);
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

  it("gives a bundle with one leg left no sublabel", () => {
    const one = buildPlanInventory(
      { ...tree, assetTransactions: [{ id: "s1", name: "Move — Sell House", type: "sell", year: 2030, bundleId: "B1" }] } as unknown as ClientData,
      [],
      "c",
    ).filter((i) => i.typeKey === "asset_transaction");
    expect(one[0].sublabel).toBeUndefined();
  });

  it("skips entity- and business-owned incomes and expenses (no page pencil)", () => {
    expect(ids("income")).toEqual(["i-sal"]);
    expect(ids("expense")).not.toContain("x-ent");
    expect(ids("expense")).not.toContain("x-biz");
  });

  it("skips legacy notes_receivable accounts", () => {
    expect(items.map((i) => i.id)).not.toContain("a-note");
  });

  it("skips a sub-account or liability of a business Net Worth does not list", () => {
    expect(items.map((i) => i.id)).not.toContain("a-sub-orphan");
    expect(items.map((i) => i.id)).not.toContain("l-orphan");
    expect(ids("liability").sort()).toEqual(["l-ok", "l1"]);
  });

  it("marks retirement living expenses for the living-expense levers", () => {
    expect(byType("expense").find((i) => i.id === "x-ret")?.draftRef).toEqual({ livingExpense: true });
    expect(byType("expense").find((i) => i.id === "x-trip")?.draftRef).toBeUndefined();
  });

  it("skips deduction rows that carry no id", () => {
    expect(ids("deduction")).toEqual(["dd1"]);
  });

  it("maps the remaining families to their own types", () => {
    expect(ids("note_receivable")).toEqual(["n1"]);
    expect(ids("liability").sort()).toEqual(["l-ok", "l1"]);
    expect(ids("disability_policy")).toEqual(["d1"]);
    expect(ids("will")).toEqual(["w1"]);
    expect(ids("external_beneficiary")).toEqual(["b1"]);
    expect(ids("roth_conversion")).toEqual(["rc1"]);
    expect(ids("relocation")).toEqual(["rl1"]);
    expect(ids("transfer")).toEqual(["tr1"]);
    expect(ids("reinvestment")).toEqual(["rv1"]);
    expect(ids("tax_adjustment")).toEqual(["ta1"]);
  });

  it("keys items by type and id, and sorts by group, then catalog, then label", () => {
    expect(items.every((i) => i.key === `${i.typeKey}:${i.id}`)).toBe(true);
    const groupIdx = items.map((i) => DETAIL_GROUP_ORDER.indexOf(detailType(i.typeKey).group));
    expect(groupIdx).toEqual([...groupIdx].sort((a, b) => a - b));
    const typeIdx = items.map((i) => DETAIL_TYPES.findIndex((t) => t.key === i.typeKey));
    const byGroup = items.map((_, n) => [groupIdx[n], typeIdx[n]]);
    expect(byGroup).toEqual([...byGroup].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
    const expenses = byType("expense").map((i) => i.label);
    expect(expenses).toEqual([...expenses].sort((a, b) => a.localeCompare(b)));
  });
});
