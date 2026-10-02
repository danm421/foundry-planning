"use client";

import { useEffect, useState } from "react";
import type { ClientData, ProjectionYear } from "@/engine/types";
import type { SolverMutation, SolverMutationKey } from "@/lib/solver/types";
import type { ChangesPanelChange } from "@/components/scenario/changes-panel";
import { defaultLtcEvent } from "@/lib/ltc/default-ltc-event";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { StressRow } from "./solver-stress-fields";
import { LtcEventFields } from "./ltc-event-fields";

export const LTC_HINT =
  "Puts one or both clients into paid long-term care at the age you choose. They die at the end of their care. Optionally cut living expenses during care and sell the home to help pay for it.";
export const ADD_AS_CHANGE_TOOLTIP = (scenario: string) =>
  `Saves this LTC event into ${scenario} as its own change. It shows on the Changes tab, where you can switch it on and off or edit it.`;
export const BASE_CASE_TOOLTIP = "Pick or create a scenario first. A saved LTC event lives in a scenario.";

export function LtcStressRow(props: {
  tree: ClientData;
  projectionYears: ProjectionYear[];
  scenarioId: string | null;
  scenarioName: string | null;
  clientId: string;
  savedChange: ChangesPanelChange | null;
  /** True while the Solver holds a `stress-ltc` draft (lets the row drop one a saved event has outlived). */
  hasDraft?: boolean;
  onChange(m: SolverMutation): void;
  onResetField(keys: SolverMutationKey[]): void;
  onSaved(): void;
  onEditOnChangesTab(changeId: string): void;
}) {
  const event = props.tree.ltcEvents?.[0] ?? null;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // Stale-draft rule: a saved event (on or off) is the truth. A draft stored in
  // the browser that predates it would still drive the preview and the Solver's
  // saves. Only fires while a draft exists, so it cannot loop.
  const { savedChange, hasDraft, onResetField } = props;
  useEffect(() => {
    if (savedChange && hasDraft) onResetField(["stress-ltc"]);
  }, [savedChange, hasDraft, onResetField]);

  async function addAsChange() {
    if (!event || !props.scenarioId) return;
    setSaving(true);
    setSaveError(false);
    try {
      const res = await fetch(`/api/clients/${props.clientId}/scenarios/${props.scenarioId}/changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "add", targetKind: "ltc_event", entity: event }),
      });
      if (!res.ok) throw new Error(String(res.status));
      // Stale-draft rule: the saved row is now the truth. A draft left behind
      // would overwrite it on the next re-derive.
      props.onResetField(["stress-ltc"]);
      props.onSaved();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  if (props.savedChange) {
    const name = (props.savedChange.payload as { name?: string } | null)?.name ?? "Long-term care";
    return (
      <div className="border-t border-hair pt-4">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-ink">Long-term care</span>
          <FieldTooltip text={LTC_HINT} />
        </div>
        <p className="mt-2 text-[12px] text-ink-2">
          {name}
          {!props.savedChange.enabled && <span className="text-ink-3"> (switched off)</span>}
        </p>
        <p className="mt-1 text-[11px] text-ink-3">Saved in this scenario as its own change.</p>
        <button
          type="button"
          onClick={() => props.onEditOnChangesTab(props.savedChange!.id)}
          className="mt-2 text-[12px] font-medium text-accent hover:text-accent-ink hover:underline"
        >
          Edit on Changes tab
        </button>
      </div>
    );
  }

  return (
    <StressRow
      label="Long-term care"
      hint={LTC_HINT}
      on={event !== null}
      onToggle={(checked) =>
        checked
          ? props.onChange({ kind: "stress-ltc", value: defaultLtcEvent(props.tree) })
          : props.onResetField(["stress-ltc"])
      }
    >
      {event && (
        <>
          <LtcEventFields
            event={event}
            tree={props.tree}
            projectionYears={props.projectionYears}
            onChange={(next) => props.onChange({ kind: "stress-ltc", value: next })}
          />
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={addAsChange}
              disabled={props.scenarioId === null || saving}
              className="rounded border border-hair px-2.5 py-1 text-[12px] font-medium text-ink hover:border-accent disabled:opacity-50"
            >
              Add as change
            </button>
            {props.scenarioId === null ? (
              // Said inline, not in a tooltip: a disabled button can't be hovered for help.
              <span className="text-[11px] text-ink-3">{BASE_CASE_TOOLTIP}</span>
            ) : (
              <FieldTooltip text={ADD_AS_CHANGE_TOOLTIP(props.scenarioName ?? "this scenario")} />
            )}
            {saveError && (
              <span role="alert" className="text-[11px] text-crit">
                Couldn&apos;t save. Try again.
              </span>
            )}
          </div>
        </>
      )}
    </StressRow>
  );
}
