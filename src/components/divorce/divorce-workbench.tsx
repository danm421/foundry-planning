"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  resolveAllocations,
  type DivorceDisposition,
  type DivorceTargetKind,
} from "@/lib/divorce/allocation-rules";
import { computeSideTotals } from "@/lib/divorce/side-totals";
import type { WorkbenchPayload } from "@/lib/divorce/divorce-plans";
import type { DivorceDraftSettings } from "@/lib/divorce/schemas";
import { SettingsRail } from "./settings-rail";
import { AllocationBoard } from "./division-board";

type AllocationRow = WorkbenchPayload["allocations"][number];
type SplitFilingStatus = "single" | "head_of_household";

/** The allocate handler Task 15's board calls. `pct` is 0–100, only meaningful
 *  for `split`; pass null (or omit) otherwise. */
export type OnAllocate = (
  kind: DivorceTargetKind,
  id: string,
  disposition: DivorceDisposition,
  pct: number | null,
) => void;

/** The DB plan row carries the full filing_status enum, but only single /
 *  head_of_household are valid post-split; narrow (defaulting to single). */
function asSplitFiling(s: string): SplitFilingStatus {
  return s === "head_of_household" ? "head_of_household" : "single";
}

/** Replace the row for (kind,id) or append it. Mirrors the server's per-target
 *  upsert so an optimistic edit matches what the PUT will persist. */
function upsertAllocation(rows: AllocationRow[], next: AllocationRow): AllocationRow[] {
  const i = rows.findIndex(
    (r) => r.targetKind === next.targetKind && r.targetId === next.targetId,
  );
  if (i === -1) return [...rows, next];
  const copy = rows.slice();
  copy[i] = next;
  return copy;
}

export default function DivorceWorkbench({
  payload: initialPayload,
  clientId,
}: {
  payload: WorkbenchPayload;
  clientId: string;
}) {
  const [payload, setPayload] = useState<WorkbenchPayload>(initialPayload);
  const [allocError, setAllocError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "error">("idle");

  // Latest payload for rollback snapshots without re-creating onAllocate.
  const payloadRef = useRef(payload);
  useEffect(() => {
    payloadRef.current = payload;
  });

  const { objects, allocations, plan, people } = payload;

  // Recompute the resolved map + side totals from objects + allocation rows so
  // an optimistic edit reflects instantly (the server derives the same way, so
  // reconciling with its response never disagrees).
  const resolved = useMemo(
    () => resolveAllocations(objects, allocations),
    [objects, allocations],
  );
  const totals = useMemo(
    () => computeSideTotals(objects, resolved),
    [objects, resolved],
  );

  // ---- Allocation: optimistic PUT then reconcile -------------------------
  // The handler the allocation board calls. It's defined in the shell so the
  // board stays a presentational child.
  const onAllocate = useCallback<OnAllocate>(
    async (kind, id, disposition, pct) => {
      const pctStr = disposition === "split" && pct != null ? pct.toFixed(4) : null;
      const snapshot = payloadRef.current.allocations;
      setAllocError(null);
      setPayload((p) => ({
        ...p,
        allocations: upsertAllocation(p.allocations, {
          targetKind: kind,
          targetId: id,
          disposition,
          splitPercentToSpouse: pctStr,
        }),
      }));
      try {
        const res = await fetch(
          `/api/clients/${clientId}/divorce-plan/allocations`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items: [
                {
                  targetKind: kind,
                  targetId: id,
                  disposition,
                  splitPercentToSpouse: pct ?? null,
                },
              ],
            }),
          },
        );
        if (!res.ok) throw new Error(`Allocation failed (${res.status})`);
        const server = (await res.json()) as WorkbenchPayload;
        // Reconcile ONLY the allocation rows: objects don't change on an
        // allocation write, resolved/totals are derived locally, and merging
        // the whole payload would stomp an optimistic settings edit that hasn't
        // flushed its debounced PATCH yet.
        setPayload((p) => ({ ...p, allocations: server.allocations }));
      } catch (err) {
        // Roll back to the pre-edit rows and surface the failure.
        setPayload((p) => ({ ...p, allocations: snapshot }));
        setAllocError(err instanceof Error ? err.message : "Allocation failed");
      }
    },
    [clientId],
  );

  // ---- Settings: debounced PATCH -----------------------------------------
  const pendingPatch = useRef<DivorceDraftSettings>({});
  const patchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushSettings = useCallback(async () => {
    const patch = pendingPatch.current;
    pendingPatch.current = {};
    if (Object.keys(patch).length === 0) return;
    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/clients/${clientId}/divorce-plan`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error();
      const server = (await res.json()) as WorkbenchPayload;
      // Settings never move allocations, so reconcile only the plan row — this
      // can't clobber an allocation PUT that resolved while we were in flight.
      setPayload((p) => ({ ...p, plan: server.plan }));
      setSaveStatus("idle");
    } catch {
      setSaveStatus("error");
    }
  }, [clientId]);

  const onSettingsChange = useCallback(
    (patch: DivorceDraftSettings) => {
      // Optimistic plan update so the controlled selects/state pick up the
      // choice immediately (the year field echoes its own local text).
      setPayload((p) => ({
        ...p,
        plan: {
          ...p.plan,
          ...(patch.splitYear !== undefined ? { splitYear: patch.splitYear } : {}),
          ...(patch.primaryFilingStatus !== undefined
            ? { primaryFilingStatus: patch.primaryFilingStatus }
            : {}),
          ...(patch.spouseFilingStatus !== undefined
            ? { spouseFilingStatus: patch.spouseFilingStatus }
            : {}),
          ...(patch.spouseState !== undefined
            ? { spouseState: patch.spouseState }
            : {}),
        },
      }));
      pendingPatch.current = { ...pendingPatch.current, ...patch };
      if (patchTimer.current) clearTimeout(patchTimer.current);
      patchTimer.current = setTimeout(() => void flushSettings(), 400);
    },
    [flushSettings],
  );

  // Best-effort flush of any pending settings change on unmount (keepalive so
  // it survives the navigation); no state reconcile since we're leaving.
  useEffect(() => {
    return () => {
      if (patchTimer.current) clearTimeout(patchTimer.current);
      const patch = pendingPatch.current;
      if (Object.keys(patch).length > 0) {
        void fetch(`/api/clients/${clientId}/divorce-plan`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
          keepalive: true,
        });
      }
    };
  }, [clientId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 pt-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <span className="chip">Divorce planning</span>
          <h1 className="mt-2 text-[22px] font-semibold tracking-tight text-ink">
            Split this household
          </h1>
        </div>
        {/* Task 16 mounts the commit trigger + dialog here — it receives
            clientId and gates on the resolved decisions above. */}
      </div>

      {/* One-way-door banner — copy is verbatim per spec; do not soften. */}
      <div
        role="note"
        className="flex items-start gap-2.5 rounded-[var(--radius)] border border-hair bg-card-2 px-4 py-3 text-[13px] leading-relaxed text-ink-2"
      >
        <svg
          className="mt-0.5 h-4 w-4 shrink-0 text-ink-3"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden
        >
          <circle cx="10" cy="10" r="7.5" />
          <path d="M10 9v4" strokeLinecap="round" />
          <circle cx="10" cy="6.5" r="0.75" fill="currentColor" stroke="none" />
        </svg>
        <p>
          Nothing changes until you commit. Committing creates a separate
          household and cannot be undone.
        </p>
      </div>

      {/* Board (left, scrolls) + settings rail (right); stacks on mobile so the
          settings + Abandon control stay reachable at every width. */}
      <div className="flex min-h-0 flex-1 flex-col gap-6 lg:flex-row">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-4">
          {allocError ? (
            <p className="mb-3 text-[13px] text-crit">{allocError}</p>
          ) : null}

          <AllocationBoard
            objects={objects}
            resolved={resolved}
            totals={totals}
            people={people}
            onAllocate={onAllocate}
          />
        </div>

        <div className="flex w-full shrink-0 flex-col lg:w-[320px] lg:min-h-0">
          <SettingsRail
            clientId={clientId}
            splitYear={plan.splitYear}
            primaryFilingStatus={asSplitFiling(plan.primaryFilingStatus)}
            spouseFilingStatus={asSplitFiling(plan.spouseFilingStatus)}
            spouseState={plan.spouseState}
            people={people}
            saveStatus={saveStatus}
            onChange={onSettingsChange}
          />
        </div>
      </div>
    </div>
  );
}
