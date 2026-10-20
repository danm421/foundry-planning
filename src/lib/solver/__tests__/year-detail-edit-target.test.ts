import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import type { InventoryItem } from "@/lib/scenario/plan-inventory";
import type { DetailTypeKey } from "@/lib/scenario/plan-detail-catalog";
import { yearDetailEditResolver } from "../year-detail-edit-target";

function item(typeKey: DetailTypeKey, id: string, extra: Partial<InventoryItem> = {}): InventoryItem {
  return { key: `${typeKey}:${id}`, typeKey, id, label: id, canEdit: true, canDelete: true, ...extra };
}

const inventory: InventoryItem[] = [
  item("income", "inc-pen"),
  item("social_security", "inc-ss"),
  item("expense", "exp-living"),
  item("liability", "liab-mortgage"),
  item("account", "acc-ira"),
  item("account", "acc-house"),
  item("account", "acc-annuity"),
  item("account", "acc-options"),
  item("business", "acc-biz"),
  item("life_policy", "acc-life"),
  item("disability_policy", "dis-1"),
  item("ltc_policy", "ltc-1"),
  item("asset_transaction", "txn-buy"),
  item("trust", "ent-llc"),
  item("savings_rule", "rule-early"),
  item("savings_rule", "rule-late"),
  item("note_receivable", "note-1"),
  item("tax_rates", "tax-rates", { canDelete: false }),
];

const tree = {
  savingsRules: [
    { id: "rule-early", accountId: "acc-401k", startYear: 2026, endYear: 2030 },
    { id: "rule-late", accountId: "acc-401k", startYear: 2031, endYear: 2040 },
  ],
} as unknown as ClientData;

const resolve = yearDetailEditResolver(inventory, tree, 2034);
const keyOf = (categoryKey: string, itemId: string) => resolve(categoryKey, itemId)?.key ?? null;

describe("yearDetailEditResolver", () => {
  it("opens a row keyed by its own plan id", () => {
    expect(keyOf("otherInflows", "inc-pen")).toBe("income:inc-pen");
    expect(keyOf("socialSecurity", "inc-ss")).toBe("social_security:inc-ss");
    expect(keyOf("living", "exp-living")).toBe("expense:exp-living");
    expect(keyOf("liabilities", "liab-mortgage")).toBe("liability:liab-mortgage");
    expect(keyOf("rmds", "acc-ira")).toBe("account:acc-ira");
    expect(keyOf("withdrawals", "acc-ira")).toBe("account:acc-ira");
    // A business's distributions are keyed by the business or entity itself.
    expect(keyOf("otherInflows", "acc-biz")).toBe("business:acc-biz");
    expect(keyOf("otherInflows", "ent-llc")).toBe("trust:ent-llc");
  });

  it("opens the plan row behind a synthesized row", () => {
    expect(keyOf("insurance", "premium-acc-life")).toBe("life_policy:acc-life");
    expect(keyOf("insurance", "disability-premium-dis-1")).toBe("disability_policy:dis-1");
    expect(keyOf("insurance", "ltc-premium-ltc-1")).toBe("ltc_policy:ltc-1");
    expect(keyOf("otherInflows", "policy-income-acc-life")).toBe("life_policy:acc-life");
    expect(keyOf("otherInflows", "disability-benefit-dis-1")).toBe("disability_policy:dis-1");
    expect(keyOf("otherInflows", "ltc-benefit-ltc-1")).toBe("ltc_policy:ltc-1");
    expect(keyOf("otherInflows", "life-insurance-proceeds:acc-life")).toBe("life_policy:acc-life");
    expect(keyOf("otherInflows", "technique-proceeds:txn-buy")).toBe("asset_transaction:txn-buy");
    expect(keyOf("otherInflows", "annuity:acc-annuity")).toBe("account:acc-annuity");
    expect(keyOf("otherInflows", "equity-proceeds:acc-options")).toBe("account:acc-options");
    expect(keyOf("liabilities", "technique-liab-txn-buy")).toBe("asset_transaction:txn-buy");
    expect(keyOf("realEstate", "synth-proptax-acc-house")).toBe("account:acc-house");
    expect(keyOf("realEstate", "synth-proptax-technique-acct-txn-buy")).toBe("asset_transaction:txn-buy");
  });

  it("opens the savings rule that funds an account that year", () => {
    expect(keyOf("savings", "acc-401k")).toBe("savings_rule:rule-late");
    expect(yearDetailEditResolver(inventory, tree, 2028)("savings", "acc-401k")?.key).toBe(
      "savings_rule:rule-early",
    );
    // Savings with no rule behind it (surplus cash swept to an account).
    expect(keyOf("savings", "acc-ira")).toBeNull();
  });

  it("leaves rows with no plan item, or none the Solver can open, as plain text", () => {
    expect(keyOf("taxes", "tax-federal")).toBeNull();
    expect(keyOf("insurance", "medicarePremiums")).toBeNull();
    expect(keyOf("other", "other-other")).toBeNull();
    // An entity-owned income isn't in the inventory: its Details row is read-only.
    expect(keyOf("otherInflows", "inc-entity-owned")).toBeNull();
    // Notes receivable can't be edited inside a scenario yet.
    expect(keyOf("otherInflows", "note:note-1")).toBeNull();
    expect(keyOf("otherInflows", "note-1")).toBeNull();
  });
});
