"use client";

// Asks before the Changes tab removes a plan detail from the scenario. The
// Details view skips its own delete dialog in focus mode, so for an account
// (and the business and life-insurance policy that are accounts too) this is
// the only place the cascade warning appears: removing one silently removes the
// transfers and Roth conversions that point at it. Same list as
// `AccountDeleteDialog`, from the same `/dependents` route. A failed lookup
// doesn't block the delete — the advisor just isn't shown the list.

import { useEffect, useState } from "react";
import DialogShell from "@/components/dialog-shell";
import type { AccountCascadeDependents } from "@/lib/accounts/cascade-dependents";
import type { InventoryItem } from "@/lib/scenario/plan-inventory";
import { detailType } from "@/lib/scenario/plan-detail-catalog";

export interface SolverDeleteConfirmProps {
  clientId: string;
  item: InventoryItem;
  scenarioName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ACCOUNT_BACKED = new Set<InventoryItem["typeKey"]>(["account", "business", "life_policy"]);

export function SolverDeleteConfirm({ clientId, item, scenarioName, onConfirm, onCancel }: SolverDeleteConfirmProps) {
  const checksDependents = ACCOUNT_BACKED.has(item.typeKey);
  // null = still looking (or never asked); "failed" = the lookup didn't answer.
  const [deps, setDeps] = useState<AccountCascadeDependents | "failed" | null>(null);

  useEffect(() => {
    if (!checksDependents) return;
    let cancelled = false;
    (async (): Promise<AccountCascadeDependents | "failed"> => {
      try {
        const res = await fetch(`/api/clients/${clientId}/accounts/${item.id}/dependents`);
        return res.ok ? ((await res.json()) as AccountCascadeDependents) : "failed";
      } catch {
        return "failed";
      }
    })().then((result) => {
      if (!cancelled) setDeps(result);
    });
    return () => {
      cancelled = true;
    };
  }, [clientId, item.id, checksDependents]);

  const looking = checksDependents && deps === null;
  const cascades =
    deps && deps !== "failed"
      ? [
          ...deps.transfers.map((t) => ({ kind: "Transfer", name: t.name })),
          ...deps.rothConversions.map((r) => ({ kind: "Roth conversion", name: r.name })),
        ]
      : [];

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

      {looking && (
        <p className="mt-3 text-[13px] text-ink-3">Checking for linked transfers and Roth conversions…</p>
      )}

      {cascades.length > 0 && (
        <div className="mt-3 rounded-md border border-warn/40 bg-warn/10 p-3">
          <p className="text-[13px] font-medium text-warn">
            Removing this will also remove {cascades.length} linked {cascades.length === 1 ? "item" : "items"}:
          </p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[13px] text-ink-2">
            {cascades.map((c, i) => (
              <li key={i}>
                <span className="text-ink-3">{c.kind}:</span> {c.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </DialogShell>
  );
}
