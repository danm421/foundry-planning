// src/lib/scenario/plan-inventory.ts
//
// Pure, client-safe inventory of every plan detail the Solver's Changes tab
// can Edit or Delete, built from the Solver's persisted scenario tree plus its
// gift list. Synthesized rows (policy premiums, policy income, entity checking)
// are dropped — the advisor never created them and cannot edit them.

import type { ClientData } from "@/engine/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { isSyntheticEntityChecking } from "@/lib/entities/entity-checking";
import { groupAssetTransactionBundles } from "@/lib/solver/asset-transaction-bundles";
import { describeChangeTarget } from "./describe-change-target";
import { DETAIL_GROUP_ORDER, DETAIL_TYPES, detailType, type DetailTypeKey } from "./plan-detail-catalog";

export interface InventoryItem {
  key: string; // `${typeKey}:${id}`
  typeKey: DetailTypeKey;
  /** Row id; clientId for client_info; tab id for the assumptions singletons. */
  id: string;
  label: string;
  sublabel?: string;
  canEdit: boolean;
  canDelete: boolean;
  /** For draft reconciliation: the savings rule's account, or the SS row's person. */
  draftRef?: { accountId?: string; person?: "client" | "spouse" };
}

const DEDUCTION_LABELS: Record<string, string> = {
  charitable: "Charitable deduction",
  above_line: "Above-the-line deduction",
  below_line: "Itemized deduction",
  property_tax: "Property tax deduction",
};

const fullName = (m: { firstName: string; lastName?: string | null }) =>
  [m.firstName, m.lastName].filter(Boolean).join(" ");

export function buildPlanInventory(
  tree: ClientData,
  gifts: EstateFlowGift[],
  clientId: string,
): InventoryItem[] {
  const out: InventoryItem[] = [];
  const add = (
    typeKey: DetailTypeKey,
    id: string,
    label: string,
    extra: Partial<Pick<InventoryItem, "sublabel" | "draftRef" | "canDelete">> = {},
  ) => {
    const t = detailType(typeKey);
    out.push({
      key: `${typeKey}:${id}`,
      typeKey,
      id,
      label,
      canEdit: t.edit,
      ...extra,
      canDelete: t.delete && (extra.canDelete ?? true),
    });
  };

  const accountsById = new Map(tree.accounts.map((a) => [a.id, a]));

  for (const inc of tree.incomes) {
    if (inc.source === "policy") continue;
    if (inc.type === "social_security") {
      const person = inc.owner === "spouse" ? "spouse" : "client";
      add("social_security", inc.id, inc.name, { draftRef: { person } });
    } else {
      add("income", inc.id, inc.name);
    }
  }

  for (const e of tree.expenses) {
    if (e.source === "policy") continue;
    add("expense", e.id, e.name, { canDelete: !e.isDefault });
  }

  for (const a of tree.accounts) {
    if (isSyntheticEntityChecking(a.id)) continue;
    const typeKey: DetailTypeKey =
      a.category === "business" && a.parentAccountId == null
        ? "business"
        : a.category === "life_insurance"
          ? "life_policy"
          : "account";
    add(typeKey, a.id, a.name, { canDelete: !a.isDefaultChecking });
  }

  for (const n of tree.notesReceivable ?? []) add("note_receivable", n.id, n.name);

  for (const r of tree.savingsRules) {
    add("savings_rule", r.id, describeChangeTarget("savings_rule", r, accountsById) ?? "Savings rule", {
      draftRef: { accountId: r.accountId },
    });
  }

  for (const l of tree.liabilities) add("liability", l.id, l.name);
  for (const d of tree.disabilityPolicies ?? []) add("disability_policy", d.id, d.name);

  // Every entity type opens the Family page's entity dialog, so all are "trust / entity".
  for (const e of tree.entities ?? []) add("trust", e.id, e.name ?? "Entity");

  const recipientNames = new Map<string, string>();
  for (const e of tree.entities ?? []) if (e.name) recipientNames.set(e.id, e.name);
  for (const m of tree.familyMembers ?? []) recipientNames.set(m.id, fullName(m));
  for (const b of tree.externalBeneficiaries ?? []) recipientNames.set(b.id, b.name);
  for (const g of gifts) {
    const to = recipientNames.get(g.recipient.id) ?? "recipient";
    if (g.kind === "series") {
      add("gift_series", g.id, `Recurring gift to ${to} · ${g.startYear}–${g.endYear}`);
    } else {
      add("gift", g.id, `Gift to ${to} · ${g.year}`);
    }
  }

  for (const w of tree.wills ?? []) {
    add("will", w.id, describeChangeTarget("will", w, accountsById, tree.client.firstName) ?? "Will");
  }
  for (const m of tree.familyMembers ?? []) {
    if (m.role === "client" || m.role === "spouse") continue;
    add("family_member", m.id, fullName(m));
  }
  for (const b of tree.externalBeneficiaries ?? []) add("external_beneficiary", b.id, b.name);

  for (const r of tree.rothConversions ?? []) add("roth_conversion", r.id, r.name);
  for (const r of tree.relocations ?? []) add("relocation", r.id, r.name);
  for (const t of tree.transfers ?? []) add("transfer", t.id, t.name);
  for (const r of tree.reinvestments ?? []) add("reinvestment", r.id, r.name);

  for (const bundle of groupAssetTransactionBundles(tree.assetTransactions ?? [])) {
    for (const leg of bundle.legs) {
      add("asset_transaction", leg.id, leg.name, {
        sublabel: bundle.bundleId ? bundle.name : undefined,
      });
    }
  }

  // Deduction rows carry no id until the loader supplies one; skip those.
  for (const d of tree.deductions ?? []) {
    const id = (d as { id?: string }).id;
    if (!id) continue;
    add("deduction", id, DEDUCTION_LABELS[d.type] ?? "Deduction", {
      sublabel: `${d.startYear}–${d.endYear}`,
    });
  }
  for (const t of tree.taxAdjustments ?? []) add("tax_adjustment", t.id, t.name?.trim() || "Tax adjustment");

  add("client_info", clientId, fullName(tree.client) || "Client info");
  add("tax_rates", "tax-rates", detailType("tax_rates").label);
  add("growth_inflation", "growth-inflation", detailType("growth_inflation").label);
  add("savings_withdrawals", "withdrawal", detailType("savings_withdrawals").label);

  const groupRank = (k: DetailTypeKey) => DETAIL_GROUP_ORDER.indexOf(detailType(k).group);
  const typeRank = (k: DetailTypeKey) => DETAIL_TYPES.findIndex((t) => t.key === k);
  return out.sort(
    (a, b) =>
      groupRank(a.typeKey) - groupRank(b.typeKey) ||
      typeRank(a.typeKey) - typeRank(b.typeKey) ||
      a.label.localeCompare(b.label),
  );
}
