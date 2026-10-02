// src/lib/scenario/plan-inventory.ts
//
// Pure, client-safe inventory of every plan detail the Solver's Changes tab
// can Edit or Delete, built from the Solver's persisted scenario tree plus its
// gift list.
//
// Two kinds of row are dropped:
//   - Synthesized rows the advisor never created: `withSynthesizedPremiums` and
//     `withSynthesizedDisabilityPremiums` (premium expenses),
//     `withSynthesizedPolicyIncome` (policy income, all `source: "policy"`) and
//     `withSynthesizedEntityChecking` (`isSyntheticEntityChecking` accounts).
//   - Rows their Details view refuses to open (spec R5: an item that can't open
//     must not be listed). Each skip mirrors that view's `findFocusRow` at ROW
//     level — `hasPagePencil` in income-expenses-view and `isListedBusiness` /
//     `underListedBusiness` / `accountInEstate` in balance-sheet-view. Whole
//     types gated until a later task stay listed.

import type { ClientData } from "@/engine/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { controllingEntity } from "@/engine/ownership";
import { isSyntheticEntityChecking } from "@/lib/entities/entity-checking";
import { isRetirementLivingExpense } from "@/lib/solver/living-expense";
import { DEDUCTION_TYPE_LABELS } from "@/lib/tax/deduction-type-labels";
import { groupAssetTransactionBundles } from "@/lib/solver/asset-transaction-bundles";
import { describeChangeTarget } from "./describe-change-target";
import {
  DETAIL_GROUP_ORDER,
  DETAIL_TYPES,
  SINGLETON_FOCUS_ID,
  detailType,
  type DetailTypeKey,
} from "./plan-detail-catalog";

export interface InventoryItem {
  key: string; // `${typeKey}:${id}`
  typeKey: DetailTypeKey;
  /** Row id; clientId for client_info; tab id for the assumptions singletons. */
  id: string;
  label: string;
  sublabel?: string;
  canEdit: boolean;
  canDelete: boolean;
  /** For draft reconciliation: the savings rule's account, the SS row's person,
   *  or a living expense the `living-expense-*` levers modify. */
  draftRef?: { accountId?: string; person?: "client" | "spouse"; livingExpense?: boolean };
}

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

  // Mirrors `accountInEstate` / `isListedBusiness` in balance-sheet-view.
  const entitiesById = new Map((tree.entities ?? []).map((e) => [e.id, e]));
  const isFamilyOwnedBusiness = (entityId: string | null) => {
    const e = entityId ? entitiesById.get(entityId) : undefined;
    if (!e?.entityType || !["llc", "s_corp", "c_corp", "partnership", "other"].includes(e.entityType)) {
      return false;
    }
    if (e.owners == null) return true;
    return e.owners.reduce((sum, o) => sum + (o.percent ?? 0), 0) >= 0.9999;
  };
  const accountInEstate = (a: ClientData["accounts"][number]) =>
    a.category !== "education_savings" &&
    (!controllingEntity(a) || isFamilyOwnedBusiness(controllingEntity(a)));
  const underListedBusiness = (parentAccountId: string) => {
    const p = accountsById.get(parentAccountId);
    return !!p && p.category === "business" && !p.parentAccountId && accountInEstate(p);
  };

  // Mirrors `hasPagePencil` in income-expenses-view: entity- and business-owned
  // rows sit in read-only rollups.
  const hasPagePencil = (r: { ownerEntityId?: string | null; ownerAccountId?: string | null }) =>
    !r.ownerEntityId && !r.ownerAccountId;

  for (const inc of tree.incomes) {
    if (inc.source === "policy") continue;
    if (inc.type === "social_security") {
      const person = inc.owner === "spouse" ? "spouse" : "client";
      add("social_security", inc.id, inc.name, { draftRef: { person } });
    } else if (hasPagePencil(inc)) {
      add("income", inc.id, inc.name);
    }
  }

  const planStartYear = tree.planSettings?.planStartYear;
  for (const e of tree.expenses) {
    if (e.source === "policy" || !hasPagePencil(e)) continue;
    // The rows the `living-expense-scale` / `living-expense-amount` levers rewrite.
    const livingExpense = planStartYear !== undefined && isRetirementLivingExpense(e, planStartYear);
    add("expense", e.id, e.name, {
      canDelete: !e.isDefault,
      draftRef: livingExpense ? { livingExpense } : undefined,
    });
  }

  for (const a of tree.accounts) {
    if (isSyntheticEntityChecking(a.id) || a.category === "notes_receivable") continue;
    // A sub-account shows only under a business Net Worth lists.
    if (a.parentAccountId && accountInEstate(a) && !underListedBusiness(a.parentAccountId)) continue;
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

  for (const l of tree.liabilities) {
    if (l.parentAccountId && !underListedBusiness(l.parentAccountId)) continue;
    add("liability", l.id, l.name);
  }
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
        sublabel: bundle.legs.length > 1 ? bundle.name : undefined,
      });
    }
  }

  // Deduction rows carry no id until the loader supplies one; skip those.
  for (const d of tree.deductions ?? []) {
    const id = (d as { id?: string }).id;
    if (!id) continue;
    add("deduction", id, DEDUCTION_TYPE_LABELS[d.type] ?? "Deduction", {
      sublabel: `${d.startYear}–${d.endYear}`,
    });
  }
  for (const t of tree.taxAdjustments ?? []) add("tax_adjustment", t.id, t.name?.trim() || "Tax adjustment");

  add("client_info", clientId, fullName(tree.client) || "Client info");
  for (const key of ["tax_rates", "growth_inflation", "savings_withdrawals"] as const) {
    add(key, SINGLETON_FOCUS_ID[key]!, detailType(key).label);
  }

  const groupRank = (k: DetailTypeKey) => DETAIL_GROUP_ORDER.indexOf(detailType(k).group);
  const typeRank = (k: DetailTypeKey) => DETAIL_TYPES.findIndex((t) => t.key === k);
  return out.sort(
    (a, b) =>
      groupRank(a.typeKey) - groupRank(b.typeKey) ||
      typeRank(a.typeKey) - typeRank(b.typeKey) ||
      a.label.localeCompare(b.label),
  );
}
