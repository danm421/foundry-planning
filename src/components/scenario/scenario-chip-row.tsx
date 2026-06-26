"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useScenarioState } from "@/hooks/use-scenario-state";
import { useScenarioModeUI } from "./scenario-mode-wrapper";
import { PromoteScenarioDialog } from "./promote-scenario-dialog";
import { useClientAccess } from "@/components/client-access-provider";

export interface ScenarioChip {
  id: string;
  name: string;
  isBaseCase: boolean;
}

// Name prefixes used by integration tests that insert into the `scenarios`
// table (see `.insert(scenarios)` in src/**/__tests__/*.test.ts). Each test
// names rows `<prefix><uuid-slice>` and deletes them in afterEach; leaked rows
// from crashed runs are filtered out of the chip row below.
const TEST_ORPHAN_PREFIXES = [
  "writer-test-",
  "nr-loader-test-",
  "nr-fast-path-host-",
  "nr-filter-",
  "preview-fidelity-",
  "change-cid-test-",
  "change-cid-other-",
  "delta-preview-cache-",
  "delta-preview-test-",
  "load-changes-test-",
  "route-list-test-",
  "route-test-",
  "tg-gid-test-",
  "tg-test-",
  "tg-other-",
  "clone-src-",
  "flow-inherit-scn-",
  "flow-mixed-scn-",
] as const;

/**
 * Collapsed scenario selector that sits above the Details tabs. The corner
 * shows a single pill — the active scenario, styled like the old active chip
 * (amber fill, ● prefix) plus a ▾ caret. Clicking it opens a dropdown listing
 * every scenario as a bubble-styled row; the active row is filled amber, the
 * rest are outlined. Selecting a row switches scenario and closes the menu.
 *
 * "Effective active" = current `?scenario=` from the URL, or the base case
 * when no param is set. Clicking the base case row clears the URL param;
 * clicking any other row sets it.
 *
 * A pinned "+ New scenario" item at the bottom reaches into
 * `useScenarioModeUI()` to open the create-scenario dialog mounted by
 * `<ScenarioModeWrapper>`. The wrapper lives in the client layout, so this
 * component must always be rendered as a descendant of it — outside a wrapper
 * the item is a no-op.
 *
 * Each non-base row carries a hover-revealed × button that DELETEs the
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
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";
  const { scenarioId: active, setScenario } = useScenarioState(clientId);
  const { openCreate } = useScenarioModeUI();
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [promoteTarget, setPromoteTarget] = useState<ScenarioChip | null>(null);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Integration tests mint scenarios on a real client (COOPER_CLIENT_ID) on the
  // shared Neon dev branch and delete them in afterEach; a crashed/interrupted
  // run leaks them, and they pile up in the chip row. Hide every known
  // test-orphan family in the UI; leave DB rows alone. Keep this list in sync
  // with the `name:` prefixes used by `.insert(scenarios)` across *.test.ts.
  const visibleScenarios = scenarios.filter(
    (s) => !TEST_ORPHAN_PREFIXES.some((p) => s.name.startsWith(p)),
  );
  const baseId = visibleScenarios.find((s) => s.isBaseCase)?.id ?? null;
  const effectiveActive = active ?? baseId;
  const activeScenario =
    visibleScenarios.find((s) => s.id === effectiveActive) ?? null;

  // Close the dropdown on outside-click and Escape.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function handleSelect(s: ScenarioChip) {
    setScenario(s.isBaseCase ? null : s.id);
    setOpen(false);
  }

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

  async function handlePromote(s: ScenarioChip) {
    setPromotingId(s.id);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/scenarios/${s.id}/promote`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          // v1: promotes with default toggle state; full active-toggle plumbing is future-work.
          body: JSON.stringify({ toggleState: {} }),
        },
      );
      if (!res.ok) return;
      setScenario(null); // base is now the promoted plan
      router.refresh();
    } finally {
      setPromotingId(null);
      setPromoteTarget(null);
    }
  }

  return (
    <div ref={wrapperRef} className="relative inline-flex justify-end">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="px-3 h-8 rounded-full text-[13px] font-medium border border-accent bg-accent text-accent-on transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper inline-flex items-center gap-1.5"
      >
        <span aria-hidden="true">●</span>
        {activeScenario?.name ?? "Scenario"}
        <span
          aria-hidden="true"
          className={`text-[10px] transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>

      {promoteTarget && (
        <PromoteScenarioDialog
          scenarioName={promoteTarget.name}
          busy={promotingId === promoteTarget.id}
          onCancel={() => setPromoteTarget(null)}
          onConfirm={() => void handlePromote(promoteTarget)}
        />
      )}

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1.5 min-w-[200px] rounded-xl border border-hair bg-paper p-1.5 shadow-lg"
        >
          {visibleScenarios.map((s) => {
            const isActive = s.id === effectiveActive;
            const isDeleting = deletingId === s.id;
            return (
              <div
                key={s.id}
                className="relative flex items-center group"
                data-testid={`scenario-chip-${s.id}`}
              >
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  onClick={() => handleSelect(s)}
                  disabled={isDeleting}
                  className={`flex-1 px-3 h-8 rounded-full text-[13px] font-medium border text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 ${
                    isActive
                      ? "bg-accent text-accent-on border-accent"
                      : "border-transparent text-ink-3 hover:border-hair hover:text-ink"
                  }`}
                >
                  <span aria-hidden="true">{isActive ? "● " : "○ "}</span>
                  {s.name}
                </button>
                {canEdit && !s.isBaseCase && (
                  <>
                    {s.id === effectiveActive && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPromoteTarget(s);
                          setOpen(false);
                        }}
                        disabled={promotingId === s.id}
                        aria-label={`Promote scenario ${s.name} to base case`}
                        title="Promote to base case"
                        className="ml-1 w-5 h-5 shrink-0 rounded-full bg-hair text-ink-3 text-[11px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-accent hover:text-accent-on focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        ↑
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(s);
                      }}
                      disabled={isDeleting}
                      aria-label={`Delete scenario ${s.name}`}
                      title="Delete scenario"
                      className="ml-1 w-5 h-5 shrink-0 rounded-full bg-hair text-ink-3 text-[11px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-accent hover:text-accent-on focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            );
          })}
          {canEdit && (
            <>
              <div className="my-1 border-t border-hair" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  openCreate();
                }}
                className="w-full px-3 h-8 rounded-full text-[13px] text-left border border-dashed border-hair text-ink-4 hover:border-accent hover:text-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                + New scenario
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
