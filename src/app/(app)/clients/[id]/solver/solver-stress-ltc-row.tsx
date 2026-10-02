"use client";

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
  onChange(m: SolverMutation): void;
  onResetField(keys: SolverMutationKey[]): void;
  onSaved(): void;
  onEditOnChangesTab(changeId: string): void;
}) {
  const event = props.tree.ltcEvents?.[0] ?? null;
  // Task 13 adds: the saved-state branch and the Add-as-change POST.
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
              disabled={props.scenarioId === null}
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
          </div>
        </>
      )}
    </StressRow>
  );
}
