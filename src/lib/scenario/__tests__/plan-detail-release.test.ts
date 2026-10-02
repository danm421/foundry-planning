import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { PAGE_FOCUS_KINDS, resolveChangeEditor } from "../change-editor-target";
import { DETAIL_TYPES, NOT_YET_READY, detailEditorTarget, detailType } from "../plan-detail-catalog";
import { buildPlanInventory } from "../plan-inventory";

// One row of every catalog type, including the ones a scenario can't add.
const tree = {
  client: { firstName: "Pat", lastName: "Lee", spouseName: "Sam" },
  planSettings: { planStartYear: 2026 },
  accounts: [
    { id: "a-tax", name: "Brokerage", category: "taxable", owners: [] },
    { id: "a-biz", name: "Acme", category: "business", parentAccountId: null, owners: [] },
    { id: "a-life", name: "Term life", category: "life_insurance", owners: [] },
  ],
  incomes: [
    { id: "i-sal", name: "Salary", type: "salary", owner: "client" },
    { id: "i-ss", name: "SS Pat", type: "social_security", owner: "client" },
  ],
  expenses: [{ id: "x-trip", name: "Trips", type: "other" }],
  liabilities: [{ id: "l1", name: "Mortgage", owners: [] }],
  savingsRules: [{ id: "r1", accountId: "a-tax", annualAmount: 6000 }],
  notesReceivable: [{ id: "n1", name: "Note to Sam" }],
  disabilityPolicies: [{ id: "d1", name: "LTD" }],
  entities: [{ id: "t1", name: "Family Trust", entityType: "trust" }],
  wills: [{ id: "w1", grantor: "client", bequests: [] }],
  familyMembers: [{ id: "f-k", role: "child", firstName: "Kim", lastName: "Lee" }],
  externalBeneficiaries: [{ id: "b1", name: "Red Cross", kind: "charity", charityType: "public" }],
  rothConversions: [{ id: "rc1", name: "Roth 2030" }],
  relocations: [{ id: "rl1", name: "Move to FL" }],
  transfers: [{ id: "tr1", name: "Sweep" }],
  reinvestments: [{ id: "rv1", name: "De-risk" }],
  assetTransactions: [{ id: "s1", name: "Sell stock", type: "sell", year: 2031 }],
  deductions: [{ id: "dd1", type: "charitable", annualAmount: 5000, growthRate: 0, startYear: 2026, endYear: 2030 }],
  taxAdjustments: [{ id: "ta1", name: "Prior bonus", annualAmount: 100 }],
} as unknown as ClientData;

const gifts = [
  { kind: "cash-once", id: "g1", year: 2030, amount: 10, grantor: "client", recipient: { kind: "external_beneficiary", id: "b1" }, crummey: false },
  { kind: "series", id: "g2", startYear: 2028, endYear: 2032, annualAmount: 1, amountMode: "fixed", inflationAdjust: false, grantor: "client", recipient: { kind: "entity", id: "t1" }, crummey: false },
] as unknown as EstateFlowGift[];

describe("release-wide Add / Edit / Delete readiness", () => {
  it("only notes receivable stay hidden (a scenario's notes partition is never read by the loader, ruling T19)", () => {
    expect([...NOT_YET_READY]).toEqual(["note_receivable"]);
  });

  it("trust / entity Add stays off (AddTrustForm refuses every create inside a scenario, ruling T10)", () => {
    expect(detailType("trust")).toMatchObject({ add: false, edit: true, delete: true });
  });

  it("no scenario kind is unsupported any more", () => {
    for (const kind of ["reinvestment", "family_member", "external_beneficiary",
      "client_deduction", "client_tax_adjustment", "withdrawal_strategy"] as const) {
      expect(
        resolveChangeEditor({ opType: "edit", targetKind: kind, targetId: "x", payload: {}, enabled: true })?.surface,
      ).toBe("details");
    }
    expect(
      resolveChangeEditor({ opType: "edit", targetKind: "entity", targetId: "x", payload: { name: { from: "a", to: "b" } }, enabled: true })?.surface,
    ).toBe("details");
  });

  const items = buildPlanInventory(tree, gifts, "c1", new Set(["g2"]));

  it("the fixture covers every catalog type that is ready", () => {
    const covered = new Set(items.map((i) => i.typeKey));
    for (const t of DETAIL_TYPES) {
      if (!NOT_YET_READY.has(t.key)) expect(covered.has(t.key), t.key).toBe(true);
    }
  });

  it("R5: every inventory item routes to a page whose view handles its focus kind", () => {
    for (const item of items) {
      if (NOT_YET_READY.has(item.typeKey)) continue;
      const t = detailEditorTarget(item.typeKey, { intent: "edit", id: item.id });
      expect(PAGE_FOCUS_KINDS[t.page], item.key).toContain(t.focus.kind);
      if (item.canDelete) {
        const d = detailEditorTarget(item.typeKey, { intent: "delete", id: item.id });
        expect(PAGE_FOCUS_KINDS[d.page], `${item.key} delete`).toContain(d.focus.kind);
      }
    }
  });

  it("R5: every addable catalog type routes its create to a page whose view handles it", () => {
    for (const t of DETAIL_TYPES) {
      if (!t.add || NOT_YET_READY.has(t.key)) continue;
      const target = detailEditorTarget(t.key, { intent: "create", variant: t.variants?.[0]?.value });
      expect(PAGE_FOCUS_KINDS[target.page], `${t.key} create`).toContain(target.focus.kind);
    }
  });
});
