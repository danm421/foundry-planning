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

import { useMemo } from "react";
import DialogShell from "@/components/dialog-shell";
import type { ClientData } from "@/engine/types";
import { resolveCascades } from "@/engine/scenario/cascadeResolution";
import type { InventoryItem } from "@/lib/scenario/plan-inventory";
import { detailType } from "@/lib/scenario/plan-detail-catalog";

export interface SolverDeleteConfirmProps {
  /** The scenario's persisted plan (never the working tree with unsaved levers). */
  tree: ClientData;
  /** Names the dropped rows the way the pickers do (a savings rule has no name of its own). */
  inventory: InventoryItem[];
  item: InventoryItem;
  scenarioName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ACCOUNT_BACKED = new Set<InventoryItem["typeKey"]>(["account", "business", "life_policy"]);

export function SolverDeleteConfirm({ tree, inventory, item, scenarioName, onConfirm, onCancel }: SolverDeleteConfirmProps) {
  const dropped = useMemo(
    () =>
      ACCOUNT_BACKED.has(item.typeKey)
        ? resolveCascades(structuredClone(tree), [{ kind: "account", id: item.id, causedByChangeId: item.id }]).map(
            (w) => {
              const named = inventory.find((i) => i.id === w.affectedEntityId);
              // "Savings rule · <id>" -> "Savings rule · 401(k) — Pat" when we know the name.
              return named ? `${w.affectedEntityLabel.split(" · ")[0]} · ${named.label}` : w.affectedEntityLabel;
            },
          )
        : [],
    [tree, inventory, item],
  );

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
        {`Remove ${item.label} from ${scenarioName}? You can switch it back on in the list below.`}
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
    </DialogShell>
  );
}
