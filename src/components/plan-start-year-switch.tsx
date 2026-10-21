"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useClientAccess } from "@/components/client-access-provider";
import { SwitchControl } from "@/components/forms/switch-control";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import type { AlreadyDoneItem } from "@/lib/plan-start/already-done-items";

const KIND_LABEL: Record<AlreadyDoneItem["kind"], string> = {
  gift: "Gift",
  asset_sale: "Sale",
  asset_purchase: "Purchase",
  transfer: "Transfer",
  roth_conversion: "Roth conversion",
  reinvestment: "Reinvestment",
  stock_exercise: "Option exercise",
};

interface Props {
  clientId: string;
  /** The BASE plan's start year — the switch never writes a scenario. */
  planStartYear: number;
  /** `currentPlanningYear()`, read on the server. */
  thisYear: number;
  inScenario: boolean;
  alreadyDone: AlreadyDoneItem[];
}

/**
 * "Start the plan next year": a view over the base plan's start year — on
 * exactly when it is next year. Saves straight to the base plan-settings route
 * (never the scenario autosave, which would write a scenario overlay), flips
 * optimistically, and reverts with the server's message when the save fails.
 */
export function PlanStartYearSwitch({ clientId, planStartYear, thisYear, inScenario, alreadyDone }: Props) {
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";
  const router = useRouter();
  const [on, setOn] = useState(planStartYear === thisYear + 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(next: boolean) {
    if (!canEdit || busy) return;
    setOn(next);
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/plan-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planStartYear: next ? thisYear + 1 : thisYear }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setOn(!next);
        setError(body.error ?? `Save failed (HTTP ${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setOn(!next);
      setError("Save failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const startYear = on ? thisYear + 1 : thisYear;

  return (
    <section className="rounded-lg border border-hair bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium text-ink">
            Start the plan next year
            <FieldTooltip
              text={`Today's balances become the January 1, ${thisYear + 1} starting point, and anything dated ${thisYear} counts as already done. Switches off on January 1.`}
            />
          </div>
          <p className="mt-0.5 text-xs text-ink-3">
            Starts <span className="tabular">January 1, {startYear}</span>
          </p>
          {inScenario ? (
            <p className="text-xs text-ink-3">Applies to the base plan and every scenario.</p>
          ) : null}
        </div>
        <SwitchControl
          checked={on}
          onChange={handleChange}
          disabled={!canEdit || busy}
          ariaLabel="Start the plan next year"
        />
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-xs text-crit">
          {error}
        </p>
      ) : null}

      {on && alreadyDone.length > 0 ? (
        <div className="mt-3 border-t border-hair pt-3">
          <p className="text-xs font-medium text-ink-2">
            Dated <span className="tabular">{thisYear}</span>: counted as already done
          </p>
          <p className="text-xs text-ink-3">Make sure balances reflect them.</p>
          <ul className="mt-2 space-y-1">
            {alreadyDone.map((item) => (
              <li key={`${item.kind}:${item.label}:${item.year}`} className="flex items-baseline gap-2 text-sm text-ink-2">
                <span className="w-28 shrink-0 text-xs text-ink-3">{KIND_LABEL[item.kind]}</span>
                <span className="min-w-0">{item.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
