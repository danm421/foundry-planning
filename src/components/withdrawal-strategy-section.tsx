"use client";

import { useState } from "react";
import ConfirmDeleteDialog from "./confirm-delete-dialog";
import MilestoneYearPicker from "./milestone-year-picker";
import type { YearRef, ClientMilestones } from "@/lib/milestones";
import { defaultWithdrawalRefs, resolveMilestone } from "@/lib/milestones";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WithdrawalAccount {
  id: string;
  name: string;
  category: string;
  subType: string;
  isDefaultChecking?: boolean | null;
  ownerEntityId?: string | null;
}

export interface WithdrawalStrategy {
  id: string;
  accountId: string;
  priorityOrder: number;
  startYear: number;
  endYear: number;
  startYearRef?: string | null;
  endYearRef?: string | null;
}

interface WithdrawalStrategySectionProps {
  clientId: string;
  accounts: WithdrawalAccount[];
  initialStrategies: WithdrawalStrategy[];
  milestones?: ClientMilestones;
  clientFirstName?: string;
  spouseFirstName?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function yearsDescriptor(start: number, end: number): string {
  return `${start}–${end}`;
}

function TrashIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// ── Dialog ────────────────────────────────────────────────────────────────────

interface DialogProps {
  clientId: string;
  accounts: WithdrawalAccount[];
  nextPriority: number;
  milestones?: ClientMilestones;
  clientFirstName?: string;
  spouseFirstName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: WithdrawalStrategy;
  onSaved: (strategy: WithdrawalStrategy, mode: "create" | "edit") => void;
  onRequestDelete?: () => void;
}

function WithdrawalDialog({
  clientId,
  accounts,
  nextPriority,
  milestones,
  clientFirstName,
  spouseFirstName,
  open,
  onOpenChange,
  editing,
  onSaved,
  onRequestDelete,
}: DialogProps) {
  const writer = useScenarioWriter(clientId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentYear = new Date().getFullYear();
  const isEdit = Boolean(editing);

  const wdDefaultRefs = !isEdit ? defaultWithdrawalRefs() : null;
  const [startYearRef, setStartYearRef] = useState<YearRef | null>(
    (editing?.startYearRef as YearRef) ?? wdDefaultRefs?.startYearRef ?? null
  );
  const [endYearRef, setEndYearRef] = useState<YearRef | null>(
    (editing?.endYearRef as YearRef) ?? wdDefaultRefs?.endYearRef ?? null
  );
  const [startYear, setStartYear] = useState<number>(
    editing?.startYear ?? (startYearRef && milestones ? resolveMilestone(startYearRef, milestones) ?? currentYear : currentYear)
  );
  const [endYear, setEndYear] = useState<number>(
    editing?.endYear ?? (endYearRef && milestones ? resolveMilestone(endYearRef, milestones) ?? (currentYear + 30) : currentYear + 30)
  );

  if (!open) return null;

  // Only offer accounts that can actually be liquidated to cover shortfalls: exclude
  // the default checking (target, not source) and entity-owned accounts.
  const eligible = accounts.filter((a) => !a.isDefaultChecking && !a.ownerEntityId);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const data = new FormData(e.currentTarget);
    const body = {
      accountId: data.get("accountId") as string,
      priorityOrder: Number(data.get("priorityOrder") as string),
      startYear: String(startYear),
      endYear: String(endYear),
      startYearRef,
      endYearRef,
    };

    try {
      const url = isEdit
        ? `/api/clients/${clientId}/withdrawal-strategy/${editing!.id}`
        : `/api/clients/${clientId}/withdrawal-strategy`;
      // In scenario mode the writer's `add` returns `{ ok, targetId }` (not the
      // full row), and `edit` returns `{ ok }`. We synthesize a local stub so the
      // optimistic list mutation in `onSaved` lines up; `router.refresh()` (run
      // by the writer on success) will re-fetch the canonical rows.
      const newId = !isEdit
        ? typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `tmp-${Date.now()}`
        : editing!.id;
      const res = await writer.submit(
        isEdit
          ? {
              op: "edit",
              targetKind: "withdrawal_strategy",
              targetId: editing!.id,
              desiredFields: body,
            }
          : {
              op: "add",
              targetKind: "withdrawal_strategy",
              entity: { id: newId, ...body },
            },
        { url, method: isEdit ? "PUT" : "POST", body },
      );

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to save withdrawal entry");
      }

      // Base mode returns the full row; scenario mode returns `{ ok, targetId? }`.
      // Build a local stub for scenario mode so the dialog can close cleanly —
      // router.refresh() (called by writer) will pull canonical state.
      const saved: WithdrawalStrategy = writer.scenarioActive
        ? {
            id: isEdit ? editing!.id : newId,
            accountId: body.accountId,
            priorityOrder: body.priorityOrder,
            startYear: Number(body.startYear),
            endYear: Number(body.endYear),
            startYearRef: body.startYearRef,
            endYearRef: body.endYearRef,
          }
        : ((await res.json()) as WithdrawalStrategy);
      onSaved(saved, isEdit ? "edit" : "create");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={() => onOpenChange(false)} />
      <div className="relative z-10 w-full max-w-lg rounded-lg border-2 border-ink-3 ring-1 ring-black/60 bg-gray-900 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-100">
            {isEdit ? "Edit Withdrawal Entry" : "Add Withdrawal Entry"}
          </h2>
          <button onClick={() => onOpenChange(false)} className="text-gray-300 hover:text-gray-200">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="ws-account">
                Account <span className="text-red-500">*</span>
              </label>
              <select
                id="ws-account"
                name="accountId"
                required
                defaultValue={editing?.accountId ?? (eligible[0]?.id ?? "")}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {eligible.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="ws-priority">
                Priority Order
              </label>
              <input
                id="ws-priority"
                name="priorityOrder"
                type="number"
                min={1}
                required
                defaultValue={editing?.priorityOrder ?? nextPriority}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            {milestones ? (
              <>
                <MilestoneYearPicker
                  name="startYear"
                  id="ws-start"
                  value={startYear}
                  yearRef={startYearRef}
                  milestones={milestones}
                  showSSRefs={false}
                  onChange={(yr, ref) => { setStartYear(yr); setStartYearRef(ref); }}
                  label="Start Year"
                  clientFirstName={clientFirstName}
                  spouseFirstName={spouseFirstName}
                />
                <MilestoneYearPicker
                  name="endYear"
                  id="ws-end"
                  value={endYear}
                  yearRef={endYearRef}
                  milestones={milestones}
                  showSSRefs={false}
                  onChange={(yr, ref) => { setEndYear(yr); setEndYearRef(ref); }}
                  label="End Year"
                  clientFirstName={clientFirstName}
                  spouseFirstName={spouseFirstName}
                  startYearForDuration={startYear}
                />
              </>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-300" htmlFor="ws-start">
                    Start Year
                  </label>
                  <input
                    id="ws-start"
                    name="startYear"
                    type="number"
                    required
                    value={startYear}
                    onChange={(e) => { setStartYear(Number(e.target.value)); setStartYearRef(null); }}
                    className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-300" htmlFor="ws-end">
                    End Year
                  </label>
                  <input
                    id="ws-end"
                    name="endYear"
                    type="number"
                    required
                    value={endYear}
                    onChange={(e) => { setEndYear(Number(e.target.value)); setEndYearRef(null); }}
                    className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex items-center justify-between pt-2">
            {isEdit && onRequestDelete ? (
              <button
                type="button"
                onClick={onRequestDelete}
                className="rounded-md border border-red-700 bg-red-900/30 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-900/60"
              >
                Delete…
              </button>
            ) : (
              <span />
            )}
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent-deep disabled:opacity-50"
            >
              {loading ? "Saving…" : isEdit ? "Save Changes" : "Add Entry"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main section ──────────────────────────────────────────────────────────────

export default function WithdrawalStrategySection({
  clientId,
  accounts,
  initialStrategies,
  milestones,
  clientFirstName,
  spouseFirstName,
}: WithdrawalStrategySectionProps) {
  const writer = useScenarioWriter(clientId);
  const [list, setList] = useState<WithdrawalStrategy[]>(initialStrategies);
  const [editMode, setEditMode] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; editing?: WithdrawalStrategy }>({
    open: false,
  });
  const [deleting, setDeleting] = useState<WithdrawalStrategy | null>(null);

  const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const sorted = [...list].sort((a, b) => a.priorityOrder - b.priorityOrder);
  const nextPriority = list.length > 0 ? Math.max(...list.map((w) => w.priorityOrder)) + 1 : 1;

  async function performDelete(strategyId: string): Promise<boolean> {
    const res = await writer.submit(
      { op: "remove", targetKind: "withdrawal_strategy", targetId: strategyId },
      {
        url: `/api/clients/${clientId}/withdrawal-strategy/${strategyId}`,
        method: "DELETE",
      },
    );
    if (!res.ok && res.status !== 204) {
      const json = await res.json().catch(() => ({}));
      alert(json.error ?? "Failed to delete");
      return false;
    }
    return true;
  }

  return (
    <section>
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-300">
            Withdrawal Strategy
          </h3>
          <p className="mt-1 text-xs text-gray-400">
            When household income can&apos;t cover expenses and savings, the projection pulls from
            these accounts in priority order. If left empty, the default order is{" "}
            <span className="font-medium text-gray-300">
              Cash → Taxable → Tax-Deferred → Roth
            </span>{" "}
            (illiquid accounts are skipped).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {list.length > 0 && (
            <button
              onClick={() => setEditMode((v) => !v)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                editMode
                  ? "border-accent bg-accent/15 text-accent-ink"
                  : "border-gray-700 bg-gray-900 text-gray-300 hover:bg-gray-800"
              }`}
            >
              {editMode ? "Done" : "Edit"}
            </button>
          )}
          <button
            onClick={() => setDialog({ open: true })}
            disabled={accounts.length === 0}
            className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-on hover:bg-accent-deep disabled:opacity-40"
          >
            + Add
          </button>
        </div>
      </header>

      <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900/50">
        {sorted.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            No custom order set — the default tax-efficient order applies.
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {sorted.map((ws) => (
              <div
                key={ws.id}
                onClick={() => !editMode && setDialog({ open: true, editing: ws })}
                className="flex cursor-pointer items-center gap-3 px-4 py-2 hover:bg-gray-800/60"
              >
                <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gray-800 text-xs font-bold text-gray-200">
                  {ws.priorityOrder}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-gray-100">
                    {accountMap[ws.accountId]?.name ?? ws.accountId}
                  </div>
                  <div className="truncate text-xs text-gray-400">
                    {yearsDescriptor(ws.startYear, ws.endYear)}
                  </div>
                </div>
                {editMode && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleting(ws);
                    }}
                    className="text-gray-400 hover:text-red-400"
                    aria-label={`Delete ${accountMap[ws.accountId]?.name ?? ws.accountId}`}
                  >
                    <TrashIcon />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {dialog.open && (
        <WithdrawalDialog
          key={dialog.editing?.id ?? "new"}
          clientId={clientId}
          accounts={accounts}
          nextPriority={nextPriority}
          milestones={milestones}
          clientFirstName={clientFirstName}
          spouseFirstName={spouseFirstName}
          open={dialog.open}
          onOpenChange={(o) => setDialog((d) => ({ ...d, open: o, editing: o ? d.editing : undefined }))}
          editing={dialog.editing}
          onSaved={(strategy, mode) => {
            if (mode === "create") setList((prev) => [...prev, strategy]);
            else setList((prev) => prev.map((w) => (w.id === strategy.id ? strategy : w)));
          }}
          onRequestDelete={() => {
            if (dialog.editing) setDeleting(dialog.editing);
          }}
        />
      )}

      <ConfirmDeleteDialog
        open={!!deleting}
        title="Delete Withdrawal Entry"
        message={
          deleting
            ? `Remove "${accountMap[deleting.accountId]?.name ?? "account"}" from the withdrawal order?`
            : ""
        }
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const ok = await performDelete(deleting.id);
          if (ok) {
            setList((prev) => prev.filter((w) => w.id !== deleting.id));
            setDialog({ open: false });
            setDeleting(null);
          }
        }}
      />
    </section>
  );
}
