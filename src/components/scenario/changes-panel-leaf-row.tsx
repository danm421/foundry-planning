"use client";

// src/components/scenario/changes-panel-leaf-row.tsx
//
// Single change row inside <ChangesPanel>'s ungrouped (and, in Task 19,
// toggle-group) sections. Shows op glyph + label + subtext + a hover-revealed
// revert button. Reverting fires a DELETE on
// `/api/clients/[id]/scenarios/[sid]/changes?kind=&target=&op=` — the same
// route the writer hook uses for revert. After a successful delete we call
// `router.refresh()` so the layout's server-side fetch re-runs and the panel
// state stays in sync without a full reload.

import { useRouter } from "next/navigation";
import { TrashIcon } from "@/components/icons";
import type { ScenarioChange } from "@/engine/scenario/types";

const OP_ICON: Record<ScenarioChange["opType"], { glyph: string; color: string }> = {
  add: { glyph: "+", color: "text-[#7fa97f]" },
  remove: { glyph: "−", color: "text-[#c87a7a]" },
  edit: { glyph: "Δ", color: "text-[#d4a04a]" },
};

export interface ChangesPanelLeafRowProps {
  clientId: string;
  scenarioId: string;
  change: ScenarioChange;
  /**
   * Resolved display name for the change's target entity (e.g. "Salary" for
   * an income, "401(k)" for an account). Built in `loadPanelData` from the
   * effective tree. Falls back to a UUID slice when undefined — typically
   * only for `remove` ops on entities the effective tree no longer contains.
   */
  targetName?: string;
}

export function ChangesPanelLeafRow({
  clientId,
  scenarioId,
  change,
  targetName,
}: ChangesPanelLeafRowProps) {
  const router = useRouter();
  const op = OP_ICON[change.opType];

  async function handleRevert() {
    const params = new URLSearchParams({
      kind: change.targetKind,
      target: change.targetId,
      op: change.opType,
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
      data-testid={`leaf-row-${change.id}`}
      className="px-4 py-2 hover:bg-[#0b0c0f]/50 group flex items-start gap-2"
    >
      <span className={`font-mono w-3 ${op.color}`} aria-label={change.opType}>
        {op.glyph}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-[#e7e6e2] truncate">{labelFor(change, targetName)}</div>
        <div className="text-xs text-[#a09c92] truncate">{subtextFor(change)}</div>
      </div>
      <button
        type="button"
        onClick={handleRevert}
        className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100 text-[#7a5b29] hover:text-[#c87a7a] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#d4a04a] rounded p-1 shrink-0"
        aria-label="Revert change"
        title="Revert this change"
      >
        <TrashIcon width={14} height={14} aria-hidden="true" />
      </button>
    </div>
  );
}

function labelFor(change: ScenarioChange, targetName: string | undefined): string {
  // Resolution order: caller-provided name (from effective tree) → payload.name
  // (works for op=add where payload IS the entity) → UUID slice fallback.
  const payloadName =
    change.payload &&
    typeof change.payload === "object" &&
    typeof (change.payload as Record<string, unknown>).name === "string"
      ? ((change.payload as Record<string, unknown>).name as string)
      : null;
  const name = targetName ?? payloadName ?? change.targetId.slice(0, 8);
  return `${humanizeKind(change.targetKind)} — ${name}`;
}

function subtextFor(change: ScenarioChange): string {
  if (change.opType === "add") return "Added in this scenario";
  if (change.opType === "remove") return "Removed in this scenario";

  // edit: payload is { fieldName: { from, to } } per changes-writer.ts
  const payload = change.payload as
    | Record<string, { from: unknown; to: unknown }>
    | null
    | undefined;
  if (!payload || typeof payload !== "object") return "";
  return Object.entries(payload)
    .map(([f, fromTo]) => {
      if (
        fromTo == null ||
        typeof fromTo !== "object" ||
        !("from" in fromTo) ||
        !("to" in fromTo)
      ) {
        return "";
      }
      return `${f}: Base ${formatVal(fromTo.from)} → Scenario ${formatVal(fromTo.to)}`;
    })
    .filter(Boolean)
    .join(" · ");
}

function humanizeKind(k: string): string {
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
