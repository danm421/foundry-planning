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
 * shows a single pill — the active scenario (accent fill, ● prefix) plus a ▾
 * caret. Clicking it opens a fixed-width menu on a raised `card` surface
 * listing every scenario as one row; the active row carries an accent wash and
 * dot. Selecting a row switches scenario and closes the menu.
 *
 * Rows are one line each: the name truncates with an ellipsis and the full text
 * lives in `title`. Scenario names are free text and routinely run long — an
 * unbounded row wraps and paints over its neighbour, which is what made the
 * menu look transparent. The list scrolls past ~18rem so a client with many
 * scenarios can't push the menu off-screen.
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
 *
 * Each non-base row also carries a ✎ button that swaps the row for an inline
 * name field and PATCHes `/api/clients/[id]/scenarios/[sid]` with the new
 * name. Enter saves, Escape cancels (and is stopped from bubbling so it
 * doesn't also close the menu). The base case is deliberately not renamable:
 * several surfaces (the compare picker, the presentation launcher) label the
 * base with the literal string "Base case" rather than its stored name, so
 * renaming it there would read inconsistently across the app.
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
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
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

  // Closing the menu discards an in-progress rename, so reopening starts clean.
  useEffect(() => {
    if (open) return;
    setRenamingId(null);
    setRenameDraft("");
    setRenameError(null);
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

  function startRename(s: ScenarioChip) {
    setRenamingId(s.id);
    setRenameDraft(s.name);
    setRenameError(null);
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameDraft("");
    setRenameError(null);
  }

  async function handleRename(s: ScenarioChip) {
    const name = renameDraft.trim();
    if (!name || renameBusy) return;
    // No-op edits shouldn't cost a round trip or an audit row.
    if (name === s.name) {
      cancelRename();
      return;
    }
    setRenameBusy(true);
    setRenameError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/scenarios/${s.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        setRenameError("Couldn't rename — try again.");
        return;
      }
      cancelRename();
      router.refresh();
    } catch {
      setRenameError("Couldn't rename — try again.");
    } finally {
      setRenameBusy(false);
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
        title={activeScenario?.name}
        className="inline-flex h-8 max-w-[16rem] items-center gap-1.5 rounded-full border border-accent bg-accent px-3 text-[13px] font-medium text-accent-on transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
      >
        <span aria-hidden="true" className="shrink-0 text-[9px] leading-none">
          ●
        </span>
        <span className="truncate">{activeScenario?.name ?? "Scenario"}</span>
        <span
          aria-hidden="true"
          className={`shrink-0 text-[10px] transition-transform ${open ? "rotate-180" : ""}`}
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
          aria-label="Scenario"
          className="absolute right-0 top-full z-30 mt-2 w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-[var(--radius)] border border-hair-2 bg-card shadow-lg"
        >
          <div className="max-h-[min(60vh,18rem)] overflow-y-auto p-1">
            {visibleScenarios.map((s) => {
              const isActive = s.id === effectiveActive;
              const isDeleting = deletingId === s.id;
              const isRenaming = renamingId === s.id;
              if (isRenaming) {
                return (
                  <form
                    key={s.id}
                    data-testid={`scenario-chip-${s.id}`}
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleRename(s);
                    }}
                    className="rounded-[var(--radius-sm)] bg-card-2 px-1.5 py-1.5"
                  >
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          // Escape cancels the rename only — stop it before the
                          // document listener closes the whole menu.
                          if (e.key === "Escape") {
                            e.stopPropagation();
                            cancelRename();
                          }
                        }}
                        maxLength={60}
                        disabled={renameBusy}
                        aria-label={`Rename scenario ${s.name}`}
                        className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-hair bg-paper px-2 py-1 text-[13px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                      />
                      <button
                        type="submit"
                        disabled={!renameDraft.trim() || renameBusy}
                        aria-label={`Save name for ${s.name}`}
                        title="Save"
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[13px] leading-none text-ink-3 transition hover:bg-accent-wash hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        onClick={cancelRename}
                        aria-label={`Cancel renaming ${s.name}`}
                        title="Cancel"
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[13px] leading-none text-ink-4 transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        ✕
                      </button>
                    </div>
                    {renameError && (
                      <div role="alert" className="px-1 pt-1 text-[11px] text-crit">
                        {renameError}
                      </div>
                    )}
                  </form>
                );
              }
              return (
                <div
                  key={s.id}
                  data-testid={`scenario-chip-${s.id}`}
                  className={`group flex items-center rounded-[var(--radius-sm)] pr-1 transition-colors ${
                    isActive ? "bg-accent-wash" : "hover:bg-card-2"
                  }`}
                >
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    onClick={() => handleSelect(s)}
                    disabled={isDeleting}
                    title={s.name}
                    className={`flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-sm)] py-1.5 pl-2.5 pr-1 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 ${
                      isActive
                        ? "font-medium text-ink"
                        : "text-ink-2 group-hover:text-ink"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`shrink-0 text-[9px] leading-none ${
                        isActive ? "text-accent" : "text-ink-4"
                      }`}
                    >
                      {isActive ? "● " : "○ "}
                    </span>
                    <span className="truncate">{s.name}</span>
                  </button>
                  {canEdit && !s.isBaseCase && (
                    <>
                      {isActive && (
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
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[11px] leading-none text-ink-4 opacity-0 transition hover:bg-accent-wash hover:text-accent focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent group-focus-within:opacity-100 group-hover:opacity-100"
                        >
                          ↑
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          startRename(s);
                        }}
                        aria-label={`Rename scenario ${s.name}`}
                        title="Rename scenario"
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[11px] leading-none text-ink-4 opacity-0 transition hover:bg-accent-wash hover:text-accent focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent group-focus-within:opacity-100 group-hover:opacity-100"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDelete(s);
                        }}
                        disabled={isDeleting}
                        aria-label={`Delete scenario ${s.name}`}
                        title="Delete scenario"
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[13px] leading-none text-ink-4 opacity-0 transition hover:text-crit focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent group-focus-within:opacity-100 group-hover:opacity-100 disabled:opacity-50"
                      >
                        ×
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {canEdit && (
            <div className="border-t border-hair p-1">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  openCreate();
                }}
                className="flex min-h-8 w-full items-center rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[13px] text-ink-3 transition-colors hover:bg-card-2 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                + New scenario
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
