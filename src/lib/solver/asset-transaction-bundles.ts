// Legs saved from one Add Asset Transactions dialog share a `bundleId`, so the
// Techniques list can show them as ONE technique. Pure display grouping — the
// projection still reads each leg as its own buy or sell row.

import type { AssetTransaction } from "@/engine/types";
import { isEnabled } from "@/lib/solver/technique-enabled";
import { summarizeAssetTransaction } from "@/lib/solver/technique-summaries";

/** The separator `deriveLegName` writes between the bundle name and the leg. */
const SEPARATOR = " — ";

export interface AssetTransactionBundle {
  /** Stable list key: `bundle:<id>`, or `solo:<legId>` for an un-bundled row. */
  key: string;
  bundleId: string | null;
  legs: AssetTransaction[];
  name: string;
  summary: string;
  /** On only when every leg is on. */
  enabled: boolean;
}

/** "Move house — Sell 45 Oak Ave" → "45 Oak Ave". */
export function legLabelFromName(name: string): string {
  const i = name.indexOf(SEPARATOR);
  const tail = i >= 0 ? name.slice(i + SEPARATOR.length) : name;
  return tail.replace(/^(Sell|Buy) /, "");
}

const prefixOf = (name: string): string | null => {
  const i = name.indexOf(SEPARATOR);
  return i >= 0 ? name.slice(0, i) : null;
};

/** The name the dialog typed, recovered from the legs it derived. Falls back to
 *  the first leg's whole name when the legs no longer share a prefix. */
export function bundleNameFromLegs(legs: { name: string }[]): string {
  const first = legs[0]?.name ?? "";
  const shared = prefixOf(first);
  if (shared && legs.every((l) => prefixOf(l.name) === shared)) return shared;
  return first;
}

function legLabel(leg: AssetTransaction, accountNames?: Map<string, string>): string {
  if (leg.type === "buy") return leg.assetName ?? legLabelFromName(leg.name);
  const source = leg.accountId ?? leg.businessAccountId;
  return (source ? accountNames?.get(source) : undefined) ?? legLabelFromName(leg.name);
}

function summarizeBundle(
  legs: AssetTransaction[],
  accountNames?: Map<string, string>,
): string {
  // A lone transaction keeps today's line verbatim.
  if (legs.length === 1) return summarizeAssetTransaction(legs[0]);

  const years = [...new Set(legs.map((l) => l.year))].sort((a, b) => a - b);
  const yearLabel = years.length === 1 ? String(years[0]) : `${years[0]}–${years[years.length - 1]}`;
  const sells = legs.filter((l) => l.type === "sell");
  const buys = legs.filter((l) => l.type === "buy");

  if (sells.length === 1 && buys.length === 1) {
    return `Sell ${legLabel(sells[0], accountNames)} + Buy ${legLabel(buys[0], accountNames)} · ${yearLabel}`;
  }
  const parts: string[] = [];
  if (sells.length) parts.push(`${sells.length} ${sells.length === 1 ? "sell" : "sells"}`);
  if (buys.length) parts.push(`${buys.length} ${buys.length === 1 ? "buy" : "buys"}`);
  return `${parts.join(" + ")} · ${yearLabel}`;
}

export function groupAssetTransactionBundles(
  txs: AssetTransaction[],
  accountNames?: Map<string, string>,
): AssetTransactionBundle[] {
  const order: string[] = [];
  const byKey = new Map<string, AssetTransaction[]>();
  for (const t of txs) {
    const key = t.bundleId ? `bundle:${t.bundleId}` : `solo:${t.id}`;
    const legs = byKey.get(key);
    if (legs) legs.push(t);
    else {
      byKey.set(key, [t]);
      order.push(key);
    }
  }
  return order.map((key) => {
    const legs = byKey.get(key)!;
    return {
      key,
      bundleId: legs[0].bundleId ?? null,
      legs,
      name: legs.length === 1 ? legs[0].name : bundleNameFromLegs(legs),
      summary: summarizeBundle(legs, accountNames),
      enabled: legs.every((l) => isEnabled(l)),
    };
  });
}
