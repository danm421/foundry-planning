"use client";

import { useState } from "react";
import type { ClientData, ProjectionYear } from "@/engine/types";
import type { SolverMutation, SolverMutationKey } from "@/lib/solver/types";
import type { ChangesPanelChange } from "@/components/scenario/changes-panel";
import { useClientAccess } from "@/components/client-access-provider";
import { resolveLtcEvent } from "@/engine/ltc-event";
import { defaultLtcEvent } from "@/lib/ltc/default-ltc-event";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { StressRow } from "./solver-stress-fields";
import { LtcEventFields, LtcWarnings } from "./ltc-event-fields";
import { saveLtcEvent } from "./save-ltc-event";

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
  onChange(m: SolverMutation): void;
  onResetField(keys: SolverMutationKey[]): void;
  onSaved(): void;
  onEditOnChangesTab(changeId: string): void;
}) {
  const event = props.tree.ltcEvents?.[0] ?? null;
  const canEdit = useClientAccess().permission === "edit";
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  async function addAsChange() {
    if (!event || !props.scenarioId) return;
    setSaving(true);
    setSaveError(false);
    try {
      await saveLtcEvent(props.clientId, props.scenarioId, event);
      // The workspace drops the draft once the refreshed change list carries the
      // saved event (stale-draft rule) — not here, which would leave the row
      // open for a second Add before that list arrives.
      props.onSaved();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  if (props.savedChange) {
    const { id, enabled, payload } = props.savedChange;
    const name = (payload as { name?: string } | null)?.name ?? "Long-term care";
    // Switched on, the working tree carries the saved event: show what the
    // engine had to drop. Switched off, nothing of it applies.
    const warnings = enabled ? (resolveLtcEvent(props.tree)?.warnings ?? []) : [];
    return (
      <div className="border-t border-hair pt-4">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-ink">Long-term care</span>
          <FieldTooltip text={LTC_HINT} />
        </div>
        <p className="mt-2 text-[12px] text-ink-2">
          {name}
          {!enabled && <span className="text-ink-3"> (switched off)</span>}
        </p>
        <p className="mt-1 text-[11px] text-ink-3">Saved in this scenario as its own change.</p>
        {warnings.length > 0 && (
          <div className="mt-1 space-y-1">
            <LtcWarnings warnings={warnings} tree={props.tree} />
          </div>
        )}
        <button
          type="button"
          onClick={() => props.onEditOnChangesTab(id)}
          className="mt-2 text-[12px] font-medium text-accent hover:text-accent-ink hover:underline"
        >
          {/* A switched-off change opens no editor there, only its on/off switch. */}
          {enabled ? "Edit on Changes tab" : "Switch it on in the Changes tab"}
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
              disabled={props.scenarioId === null || !canEdit || saving}
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
