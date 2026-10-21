// The one-time items a plan that starts next year treats as already done: the
// ones dated in the skipped year [dataYear, planStartYear). The Assumptions
// switch lists them so the advisor can check today's balances reflect them.
// Visibility only — the engine applies them either way (src/engine/skipped-year.ts).
import type { ClientData, GiftEvent } from "@/engine/types";
import { buildGrantTimeline } from "@/engine/equity/timeline";
import { resolveStrategy } from "@/engine/equity/strategy";
import { fmvCurve } from "@/engine/equity/price-model";

export type AlreadyDoneItem = {
  kind: "gift" | "asset_sale" | "asset_purchase" | "transfer" | "roth_conversion" | "reinvestment" | "stock_exercise";
  label: string;
  year: number;
};

export function listAlreadyDoneItems(tree: ClientData): AlreadyDoneItem[] {
  const { planStartYear, dataYear } = tree.planSettings;
  if (dataYear == null || dataYear >= planStartYear) return [];
  const skipped = (year: number) => year >= dataYear && year < planStartYear;
  const items: AlreadyDoneItem[] = [];

  const recipientName = (e: GiftEvent): string | undefined => {
    if (e.recipientEntityId) return tree.entities?.find((x) => x.id === e.recipientEntityId)?.name;
    if (e.kind === "business_interest") return undefined;
    if (e.recipientFamilyMemberId) {
      return tree.familyMembers?.find((m) => m.id === e.recipientFamilyMemberId)?.firstName;
    }
    if (e.recipientExternalBeneficiaryId) {
      return tree.externalBeneficiaries?.find((b) => b.id === e.recipientExternalBeneficiaryId)?.name;
    }
    return undefined;
  };
  // One entry per gift: a series occurrence, a synthesized premium gift and a
  // bundled loan are not gifts the advisor entered, and a business gift writes
  // one row per grantor under the same name.
  const seenGifts = new Set<string>();
  for (const e of tree.giftEvents ?? []) {
    if (!skipped(e.year) || e.enteredAsHistory === true || e.kind === "liability") continue;
    if (e.kind === "cash" && (e.seriesId != null || e.sourcePolicyAccountId != null)) continue;
    const name = recipientName(e);
    const label = name ? `Gift to ${name}` : "Gift";
    const key = `${e.year}|${label}`;
    if (seenGifts.has(key)) continue;
    seenGifts.add(key);
    items.push({ kind: "gift", label, year: e.year });
  }

  for (const t of tree.assetTransactions ?? []) {
    if (t.enabled === false || !skipped(t.year)) continue;
    items.push({ kind: t.type === "sell" ? "asset_sale" : "asset_purchase", label: t.name, year: t.year });
  }
  for (const t of tree.transfers ?? []) {
    if (t.mode === "one_time" && skipped(t.startYear)) items.push({ kind: "transfer", label: t.name, year: t.startYear });
  }
  for (const c of tree.rothConversions ?? []) {
    if (c.enabled === false || !skipped(c.startYear)) continue;
    // One-time: converts the whole account, or ends before the plan starts.
    if (c.conversionType === "full_account" || (c.endYear ?? c.startYear) < planStartYear) {
      items.push({ kind: "roth_conversion", label: c.name, year: c.startYear });
    }
  }
  for (const r of tree.reinvestments ?? []) {
    if (r.enabled !== false && skipped(r.year)) items.push({ kind: "reinvestment", label: r.name, year: r.year });
  }

  // An option exercise the strategy makes in the skipped year — read off the
  // same timeline the projection settles it with.
  for (const plan of tree.stockOptionPlans ?? []) {
    const strategy = resolveStrategy(plan.strategy, null, null);
    const fmvAt = fmvCurve(plan, planStartYear);
    for (const grant of plan.grants) {
      const exercised = buildGrantTimeline(grant, strategy, dataYear, fmvAt).filter(
        (a) => a.kind === "exercise" && skipped(a.year),
      );
      const years = [...new Set(exercised.map((a) => a.year))];
      for (const year of years) {
        const name = [plan.ticker, grant.grantNumber].filter(Boolean).join(" ");
        items.push({ kind: "stock_exercise", label: `${name || "Stock option"} exercise`, year });
      }
    }
  }

  return items.sort((a, b) => a.year - b.year || a.label.localeCompare(b.label));
}
