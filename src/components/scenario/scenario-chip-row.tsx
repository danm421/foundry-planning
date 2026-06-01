"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useScenarioState } from "@/hooks/use-scenario-state";
import { useScenarioModeUI } from "./scenario-mode-wrapper";

export interface ScenarioChip {
  id: string;
  name: string;
  isBaseCase: boolean;
}

/**
 * Horizontal row of pill-shaped scenario chips that sits above the Details
 * tabs. The active chip is filled amber; others are outlined; the trailing
 * "+ New scenario" button is a dashed ghost.
 *
 * "Effective active" = current `?scenario=` from the URL, or the base case
 * when no param is set. Clicking the base case chip clears the URL param;
 * clicking any other chip sets it.
 *
 * The "+ New scenario" button reaches into `useScenarioModeUI()` to open the
 * create-scenario dialog mounted by `<ScenarioModeWrapper>`. The wrapper
 * lives in the client layout, so this component must always be rendered as
 * a descendant of it — outside a wrapper the button is a no-op.
 *
 * Each non-base chip also carries a hover-revealed × button that DELETEs the
 * scenario via `/api/clients/[id]/scenarios/[sid]`. If the deleted scenario
 * was active, we strip `?scenario=` from the URL on success so the layout
 * falls back to base.
 */
export function ScenarioChipRow({
  clientId,
  scenarios,
}: {
  clientId: string;
  scenarios: ScenarioChip[];
}) {
  const { scenarioId: active, setScenario } = useScenarioState(clientId);
  const { openCreate } = useScenarioModeUI();
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Orphan integration-test scenarios (changes-writer.test.ts mints
  // `writer-test-<uuid>` rows and deletes them in afterEach; crashes leak them)
  // pile up in the chip row. Hide them in the UI; leave DB rows alone.
  const visibleScenarios = scenarios.filter(
    (s) => !s.name.startsWith("writer-test-"),
  );
  const baseId = visibleScenarios.find((s) => s.isBaseCase)?.id ?? null;
  const effectiveActive = active ?? baseId;

  async function handleDelete(s: ScenarioChip) {
    if (
      !window.confirm(
        `Delete scenario "${s.name}"? This will remove all of its changes and toggle groups.`,
      )
    ) {
      return;
    }
    setDeletingId(s.id);
    try {
      const res = await fetch(`/api/clients/${clientId}/scenarios/${s.id}`, {
        method: "DELETE",
      });
      if (!res.ok) return;
      if (s.id === effectiveActive) setScenario(null);
      router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {visibleScenarios.map((s) => {
        const isActive = s.id === effectiveActive;
        const isDeleting = deletingId === s.id;
        return (
          <div
            key={s.id}
            className="relative inline-flex group"
            data-testid={`scenario-chip-${s.id}`}
          >
            <button
              type="button"
              aria-pressed={isActive}
              onClick={() => setScenario(s.isBaseCase ? null : s.id)}
              disabled={isDeleting}
              className={`px-3 h-8 rounded-full text-[13px] font-medium border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:opacity-50 ${
                isActive
                  ? "bg-accent text-accent-on border-accent"
                  : "border-hair text-ink-3 hover:border-accent hover:text-ink"
              }`}
            >
              <span aria-hidden="true">{isActive ? "● " : "○ "}</span>
              {s.name}
            </button>
            {!s.isBaseCase && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDelete(s);
                }}
                disabled={isDeleting}
                aria-label={`Delete scenario ${s.name}`}
                title="Delete scenario"
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-hair text-ink-3 text-[11px] leading-none flex items-center justify-center border border-paper opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-accent hover:text-accent-on focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={openCreate}
        className="px-3 h-8 rounded-full text-[13px] border border-dashed border-hair text-ink-4 hover:border-accent hover:text-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
      >
        + New scenario
      </button>
    </div>
  );
}
