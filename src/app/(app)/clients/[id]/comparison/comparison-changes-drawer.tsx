"use client";

// src/app/(app)/clients/[id]/comparison/comparison-changes-drawer.tsx
//
// Right-side slide-out drawer that surfaces the per-scenario Changes panel
// (with the per-change enable/disable toggles) for both plans being compared.
// Two tabs inside the drawer — one per plan — each rendering a scoped
// <ChangesPanel>. Toggling a change PATCHes the change route and
// `router.refresh()`s, which causes Next to re-fetch the page (including the
// projections), so disabled changes drop out of the comparison live.
//
// Suppressed entirely when neither side resolves to a scenario (base/snapshot
// refs have no editable changes). The trigger button is rendered separately
// in the ComparisonPickerBar so it can sit alongside the plan pickers.
//
// Rendered through a portal to `document.body` because the picker bar uses
// `backdrop-blur`, and `backdrop-filter` creates a containing block for
// `position: fixed` descendants — without the portal the drawer would be
// clipped to the picker bar's bounds.

import { useEffect } from "react";
import { createPortal } from "react-dom";
import {
  ChangesPanel,
  type ChangesPanelChange,
} from "@/components/scenario/changes-panel";
import type {
  CascadeWarning,
  ToggleGroup,
} from "@/engine/scenario/types";
import { seriesColor } from "@/lib/comparison/series-palette";

export interface ComparisonChangesDrawerPlan {
  scenarioId: string;
  scenarioName: string;
  label: string;
  changes: ChangesPanelChange[];
  toggleGroups: ToggleGroup[];
  cascadeWarnings: CascadeWarning[];
  targetNames: Record<string, string>;
}

export interface ComparisonChangesDrawerProps {
  clientId: string;
  open: boolean;
  onClose: () => void;
  /** Currently active tab — index into `plans`. */
  activeTab: number;
  onTabChange: (idx: number) => void;
  plans: ComparisonChangesDrawerPlan[];
}

export function ComparisonChangesDrawer({
  clientId,
  open,
  onClose,
  activeTab,
  onTabChange,
  plans,
}: ComparisonChangesDrawerProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (plans.length === 0) return null;

  const safeTab = Math.min(Math.max(activeTab, 0), plans.length - 1);
  const active = plans[safeTab];

  const overlay = (
    <>
      <div
        data-testid="comparison-changes-drawer-backdrop"
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-paper/70 backdrop-blur-sm transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        data-testid="comparison-changes-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Scenario changes"
        aria-hidden={!open}
        className={`fixed right-0 top-0 z-40 h-full w-[360px] max-w-full bg-card border-l-2 border-ink-3 ring-1 ring-black/60 shadow-2xl transition-transform flex flex-col ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-hair px-4 py-2">
          <div
            role="tablist"
            aria-label="Plan changes"
            className="flex items-center gap-1 overflow-x-auto"
          >
            {plans.map((p, i) => (
              <button
                key={p.scenarioId}
                role="tab"
                type="button"
                aria-selected={i === safeTab}
                aria-controls={`drawer-tabpanel-${i}`}
                id={`drawer-tab-${i}`}
                onClick={() => onTabChange(i)}
                className={`flex items-center gap-2 px-3 h-7 rounded-full text-[12px] font-medium whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4a04a] ${
                  i === safeTab
                    ? "bg-[#d4a04a] text-[#0b0c0f]"
                    : "text-[#a09c92] hover:text-[#e7e6e2]"
                }`}
              >
                <span
                  data-testid="tab-dot"
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: seriesColor(i) }}
                  aria-hidden
                />
                {p.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close changes drawer"
            className="text-[#a09c92] hover:text-[#e7e6e2] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#d4a04a] rounded px-2 py-1"
          >
            ✕
          </button>
        </div>
        <div
          role="tabpanel"
          id={`drawer-tabpanel-${safeTab}`}
          aria-labelledby={`drawer-tab-${safeTab}`}
          className="flex-1 min-h-0 flex"
        >
          <ChangesPanel
            clientId={clientId}
            scenarioId={active.scenarioId}
            scenarioName={active.scenarioName}
            changes={active.changes}
            toggleGroups={active.toggleGroups}
            cascadeWarnings={active.cascadeWarnings}
            targetNames={active.targetNames}
          />
        </div>
      </aside>
    </>
  );

  // SSR-safe: portal target only exists in the browser. The "use client"
  // directive ensures the component is hydrated, but the very first SSR pass
  // still runs server-side where `document` is undefined.
  if (typeof document === "undefined") return null;
  return createPortal(overlay, document.body);
}
