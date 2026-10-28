"use client";

import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { qcdGiftLabel } from "@/lib/gifts/qcd-label";
import { SolverTechniqueRow } from "./solver-technique-row";

/** One-line label for a planned gift in the list. */
function giftSummary(g: EstateFlowGift, accountNameById?: ReadonlyMap<string, string>): string {
  if ((g.kind === "series" || g.kind === "cash-once") && g.qcd) {
    const label = qcdGiftLabel({
      accountName: accountNameById?.get(g.qcd.accountId) ?? "IRA",
      amountMode: g.qcd.amountMode,
      amount: g.kind === "series" ? g.annualAmount : g.amount,
      recurring: g.kind === "series",
    });
    return g.kind === "series" ? `${label} (${g.startYear}–${g.endYear})` : `${label} (${g.year})`;
  }
  if (g.kind === "series")
    return `Series ${g.startYear}–${g.endYear}: $${g.annualAmount.toLocaleString()}/yr`;
  if (g.kind === "asset-once")
    return `Asset gift ${g.year}: ${Math.round(g.percent * 100)}%`;
  return `Cash gift ${g.year}: $${g.amount.toLocaleString()}`;
}

/** Short title for a gift row (recipient-kind noun). */
function giftTitle(g: EstateFlowGift): string {
  const noun =
    g.recipient.kind === "entity" ? "Trust gift" : g.recipient.kind === "family_member" ? "Family gift" : "Charitable gift";
  return noun;
}

/** Planned Gifts section: unified list of all gifts (base + draft) rendered as
 *  SolverTechniqueRows with toggle / edit / remove. */
export function EstateGiftsList({
  gifts,
  baseGiftIds,
  onToggle,
  onEdit,
  onRemove,
  accountNameById,
}: {
  gifts: EstateFlowGift[];
  baseGiftIds: Set<string>;
  onToggle: (g: EstateFlowGift) => void;
  onEdit: (g: EstateFlowGift) => void;
  onRemove: (id: string) => void;
  /** Names a QCD gift's source IRA. */
  accountNameById?: ReadonlyMap<string, string>;
}) {
  if (gifts.length === 0) {
    return <div className="col-span-2 text-[12px] text-ink-4">No planned gifts</div>;
  }
  return (
    <div className="col-span-2 space-y-2">
      {gifts.map((g) => (
        <SolverTechniqueRow
          key={g.id}
          name={giftTitle(g)}
          summary={giftSummary(g, accountNameById)}
          enabled={g.enabled !== false}
          onToggle={() => onToggle(g)}
          badge={baseGiftIds.has(g.id) ? "Base plan" : "Added"}
          onEdit={() => onEdit(g)}
          onRemove={() => onRemove(g.id)}
        />
      ))}
    </div>
  );
}

/** Compact planned-gift on/off list for the Techniques tab — toggle + title +
 *  summary only (no Edit / Remove / Add). The heavier actions and the other
 *  estate sections stay behind the "Edit" modal. Renders nothing when there are
 *  no gifts, so callers can drop it in unconditionally. */
export function EstateGiftsToggleList({
  gifts,
  baseGiftIds,
  onToggle,
  accountNameById,
}: {
  gifts: EstateFlowGift[];
  baseGiftIds: Set<string>;
  onToggle: (g: EstateFlowGift) => void;
  /** Names a QCD gift's source IRA. */
  accountNameById?: ReadonlyMap<string, string>;
}) {
  if (gifts.length === 0) return null;
  return (
    <div className="col-span-2 space-y-2">
      {gifts.map((g) => (
        <SolverTechniqueRow
          key={g.id}
          name={giftTitle(g)}
          summary={giftSummary(g, accountNameById)}
          enabled={g.enabled !== false}
          onToggle={() => onToggle(g)}
          badge={baseGiftIds.has(g.id) ? "Base plan" : "Added"}
        />
      ))}
    </div>
  );
}
