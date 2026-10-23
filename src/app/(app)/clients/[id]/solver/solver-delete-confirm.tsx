"use client";

// Asks before the Changes tab removes a plan detail from the scenario. The
// Details view skips its own delete dialog in focus mode, so for an account
// (and the business and life-insurance policy that are accounts too) this is
// the only place the cascade warning appears. What a scenario remove drops is
// what the engine's `resolveCascades` drops — transfers, Roth conversions whose
// destination or every source is gone, savings rules, stock-option plans — so
// the list is computed from that on a COPY of the scenario's persisted plan.
// The base-table `/dependents` route would miss a scenario-added account and a
// scenario-added transfer, and it keys Roth conversions by destination only.
// Some cascades keep the linked row and clear only its link (`KEPT_KINDS`);
// those are listed apart and never counted as removed.
//
// Nothing is written: the remove is held in the Solver as an unsaved change, so
// there is one confirm for the base case and a scenario alike. `tree` is the
// Solver's tree with held changes applied, so a held add and its dependants show.
//
// On the base case, Save to base facts later runs the database delete, whose
// cascades also reach rows outside this plan (another scenario's transfer). So
// an account there also lists the Net Worth page's own read-only `/dependents`
// answer, less what the plan's list already names. A GET writes nothing.

import { useMemo } from "react";
import DialogShell from "@/components/dialog-shell";
import { AccountCascadeList, useAccountCascadeDependents } from "@/components/account-cascade-dependents";
import type { ClientData } from "@/engine/types";
import { resolveCascades } from "@/engine/scenario/cascadeResolution";
import type { CascadeWarning } from "@/engine/scenario/types";
import type { InventoryItem } from "@/lib/scenario/plan-inventory";
import { detailType } from "@/lib/scenario/plan-detail-catalog";

export interface SolverDeleteConfirmProps {
  clientId: string;
  /** "base", or the scenario the Solver works on. */
  source: "base" | string;
  /** The Solver's tree with held changes applied (never the working tree with unsaved levers). */
  tree: ClientData;
  /** Names the dropped rows the way the pickers do (a savings rule has no name of its own). */
  inventory: InventoryItem[];
  item: InventoryItem;
  onConfirm: () => void;
  onCancel: () => void;
}

const ACCOUNT_BACKED = new Set<InventoryItem["typeKey"]>(["account", "business", "life_policy"]);

/** Cascades that keep the linked row and clear only its link to the removed one:
 *  a stock-option plan loses its destination brokerage; a business's child
 *  account or debt moves to the top level. */
const KEPT_KINDS = new Set<CascadeWarning["kind"]>(["equity_destination_cleared", "parent_account_cleared"]);

export function SolverDeleteConfirm({
  clientId,
  source,
  tree,
  inventory,
  item,
  onConfirm,
  onCancel,
}: SolverDeleteConfirmProps) {
  const accountBacked = ACCOUNT_BACKED.has(item.typeKey);
  const { dropped, droppedIds, kept } = useMemo(() => {
    const warnings = accountBacked
      ? resolveCascades(structuredClone(tree), [{ kind: "account", id: item.id, causedByChangeId: item.id }])
      : [];
    const label = (w: CascadeWarning) => {
      const named = inventory.find((i) => i.id === w.affectedEntityId);
      // "Savings rule · <id>" -> "Savings rule · 401(k) — Pat" when we know the name.
      return named ? `${w.affectedEntityLabel.split(" · ")[0]} · ${named.label}` : w.affectedEntityLabel;
    };
    const removed = warnings.filter((w) => !KEPT_KINDS.has(w.kind));
    return {
      dropped: removed.map(label),
      droppedIds: new Set(removed.map((w) => w.affectedEntityId)),
      kept: warnings.filter((w) => KEPT_KINDS.has(w.kind)).map(label),
    };
  }, [tree, inventory, item, accountBacked]);

  const baseDelete = useAccountCascadeDependents(clientId, source === "base" && accountBacked ? item.id : null);
  const baseDeleteOnly = baseDelete.deps && {
    transfers: baseDelete.deps.transfers.filter((t) => !droppedIds.has(t.id)),
    rothConversions: baseDelete.deps.rothConversions.filter((r) => !droppedIds.has(r.id)),
  };

  return (
    <DialogShell
      open
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
      title={`Remove ${detailType(item.typeKey).label}`}
      size="sm"
      destructiveAction={{ label: "Remove", onClick: onConfirm }}
    >
      <p className="text-[14px] text-ink-2">
        {`Remove ${item.label}? Nothing is saved until you press a save button. You can switch it back on under "Not saved yet".`}
      </p>

      {dropped.length > 0 && (
        <div className="mt-3 rounded-md border border-warn/40 bg-warn/10 p-3">
          <p className="text-[13px] font-medium text-warn">
            Removing this will also remove {dropped.length} linked {dropped.length === 1 ? "item" : "items"}:
          </p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[13px] text-ink-2">
            {dropped.map((label, i) => (
              <li key={i}>{label}</li>
            ))}
          </ul>
        </div>
      )}

      {kept.length > 0 && (
        <div className="mt-3 rounded-md border border-hair-2 bg-card-2 p-3">
          <p className="text-[13px] font-medium text-ink-2">
            {`${kept.length === 1 ? "This linked item stays" : `These ${kept.length} linked items stay`} in the plan, no longer linked to it:`}
          </p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[13px] text-ink-2">
            {kept.map((label, i) => (
              <li key={i}>{label}</li>
            ))}
          </ul>
        </div>
      )}

      <AccountCascadeList deps={baseDeleteOnly} loading={baseDelete.loading} action="Saving this to base facts" />
    </DialogShell>
  );
}
