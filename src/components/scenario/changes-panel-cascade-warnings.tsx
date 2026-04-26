"use client";

// src/components/scenario/changes-panel-cascade-warnings.tsx
//
// Footer chip on <ChangesPanel> that surfaces engine-emitted cascade warnings.
// Replaces the stub renderer that shipped with Task 18. Per Plan 2 Task 21:
//
//   - returns null when there are no warnings (panel reserves no space)
//   - shows the warning count + a chevron, collapsed by default
//   - expanding reveals one row per warning: [entity label] message + an
//     optional [Restore] button when the warning is traceable to a remove
//     change still present in `changes`
//
// "Restore" issues a DELETE on the changes endpoint (the same path the leaf-row
// revert button uses) with the cause's kind/target/op as query params, then
// `router.refresh()` so the layout re-fetches and the panel re-renders without
// the no-longer-relevant warning.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CascadeWarning, ScenarioChange } from "@/engine/scenario/types";

export interface CascadeWarningsChipProps {
  clientId: string;
  scenarioId: string;
  warnings: CascadeWarning[];
  /**
   * The full set of scenario_changes for the scenario — needed so we can map
   * `warning.causedByChangeId` back to the (kind, target, op) tuple required
   * by the changes-DELETE endpoint. Pass the same array the panel renders.
   */
  changes: ScenarioChange[];
}

export function CascadeWarningsChip({
  clientId,
  scenarioId,
  warnings,
  changes,
}: CascadeWarningsChipProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  if (warnings.length === 0) return null;

  async function restoreCause(cause: ScenarioChange) {
    const params = new URLSearchParams({
      kind: cause.targetKind,
      target: cause.targetId,
      op: cause.opType,
    });
    const res = await fetch(
      `/api/clients/${clientId}/scenarios/${scenarioId}/changes?${params.toString()}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      router.refresh();
    }
  }

  return (
    <div
      data-testid="cascade-warnings-chip"
      className="border-t border-[#c87a7a]/40 bg-[#c87a7a]/5"
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="w-full px-4 py-2 flex items-center justify-between text-xs tracking-[0.18em] uppercase font-mono text-[#c87a7a] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#c87a7a]"
      >
        <span>
          ⚠ {warnings.length} CASCADE WARNING{warnings.length === 1 ? "" : "S"}
        </span>
        <span aria-hidden="true">{expanded ? "▴" : "▾"}</span>
      </button>
      {expanded && (
        <ul className="px-4 pb-2 space-y-1">
          {warnings.map((w, i) => {
            const cause = w.causedByChangeId
              ? changes.find((c) => c.id === w.causedByChangeId) ?? null
              : null;
            return (
              <li
                key={`${w.causedByChangeId ?? "warn"}-${i}`}
                className="text-xs text-[#c8c4ba]"
              >
                <span className="text-[#a09c92]">
                  [{w.affectedEntityLabel || "Affected"}]
                </span>{" "}
                {w.message}
                {cause && (
                  <button
                    type="button"
                    onClick={() => restoreCause(cause)}
                    className="ml-2 text-[#7a5b29] hover:text-[#d4a04a] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#d4a04a] rounded px-1"
                  >
                    [Restore]
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
