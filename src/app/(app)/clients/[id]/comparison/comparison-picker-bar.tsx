"use client";

import { useState } from "react";
import { ScenarioPickerDropdown } from "@/components/scenario/scenario-picker-dropdown";
import type {
  ScenarioOption,
  SnapshotOption,
} from "@/components/scenario/scenario-picker-dropdown";
import { useCompareState } from "@/hooks/use-compare-state";
import { seriesColor } from "@/lib/comparison/series-palette";
import {
  ComparisonChangesDrawer,
  type ComparisonChangesDrawerPlan,
} from "./comparison-changes-drawer";

interface Props {
  clientId: string;
  scenarios: ScenarioOption[];
  snapshots: SnapshotOption[];
  /** Per-plan panel data for the slide-out Changes drawer. Empty when neither
   *  side resolves to a live scenario (base/snapshot have nothing editable). */
  drawerPlans?: ComparisonChangesDrawerPlan[];
}

export function ComparisonPickerBar({
  clientId,
  scenarios,
  snapshots,
  drawerPlans = [],
}: Props) {
  const { plans, setPlanAt, addPlan, removePlanAt, makeBaseline } =
    useCompareState(clientId);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const totalChanges = drawerPlans.reduce((n, p) => n + p.changes.length, 0);

  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-950/95 px-6 py-3 backdrop-blur">
      {plans.map((planRef, i) => (
        <PlanChip
          key={`${i}-${planRef}`}
          index={i}
          planRef={planRef}
          scenarios={scenarios}
          snapshots={snapshots}
          canRemove={plans.length > 2}
          onChange={(v) => setPlanAt(i, v)}
          onRemove={() => removePlanAt(i)}
          onMakeBaseline={() => makeBaseline(i)}
        />
      ))}
      {plans.length < 4 && (
        <button
          type="button"
          onClick={addPlan}
          aria-label="Add plan"
          className="flex items-center gap-1 rounded-full border border-dashed border-slate-700 px-3 h-11 text-sm text-slate-300 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4a04a]"
        >
          <PlusIcon />
          <span>Add plan</span>
        </button>
      )}
      {drawerPlans.length > 0 && (
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open scenario changes drawer"
          className="ml-auto flex items-center gap-2 rounded-full border border-slate-700 px-3 h-8 text-xs text-slate-200 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4a04a]"
        >
          <span>Changes</span>
          <span className="font-mono text-[#d4a04a]">{totalChanges}</span>
        </button>
      )}
      <ComparisonChangesDrawer
        clientId={clientId}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        plans={drawerPlans}
      />
    </div>
  );
}

interface ChipProps {
  index: number;
  planRef: string;
  scenarios: ScenarioOption[];
  snapshots: SnapshotOption[];
  canRemove: boolean;
  onChange: (v: string) => void;
  onRemove: () => void;
  onMakeBaseline: () => void;
}

function PlanChip({
  index,
  planRef,
  scenarios,
  snapshots,
  canRemove,
  onChange,
  onRemove,
  onMakeBaseline,
}: ChipProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isBaseline = index === 0;
  const color = seriesColor(index) ?? "#cbd5e1";

  return (
    <div
      role="group"
      aria-label={`Plan ${index + 1}`}
      className="relative flex flex-col gap-1 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 min-h-[44px]"
      style={{ borderTopColor: color, borderTopWidth: 2 }}
    >
      <div className="flex items-center gap-2">
        <ScenarioPickerDropdown
          value={planRef}
          onChange={onChange}
          scenarios={scenarios}
          snapshots={snapshots}
          ariaLabel={`Plan ${index + 1}`}
        />
        {!isBaseline && (
          <>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={`More options for plan ${index + 1}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="rounded p-1 text-slate-400 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4a04a]"
            >
              <MoreVerticalIcon />
            </button>
            <button
              type="button"
              onClick={onRemove}
              disabled={!canRemove}
              aria-label={`Remove plan ${index + 1}`}
              className="rounded p-1 text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4a04a]"
            >
              <XIcon />
            </button>
          </>
        )}
      </div>
      <div className="text-[10px] uppercase tracking-wide">
        {isBaseline ? (
          <span className="rounded border border-slate-700 px-1 text-slate-400">
            Baseline
          </span>
        ) : (
          <span className="text-slate-500">vs base</span>
        )}
      </div>
      {menuOpen && !isBaseline && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-44 rounded border border-slate-700 bg-slate-900 py-1 shadow-lg"
        >
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onMakeBaseline();
            }}
            className="block w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
          >
            Make baseline
          </button>
        </div>
      )}
    </div>
  );
}

// Inline icons — lucide-react isn't a project dep (see
// `src/components/monte-carlo/recommendations-card.tsx` for the same pattern).
function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function MoreVerticalIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}
