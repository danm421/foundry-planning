"use client";

import { useState } from "react";
import ConfirmDeleteDialog from "./confirm-delete-dialog";

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
}

interface WithdrawalStrategySectionProps {
  clientId: string;
  accounts: WithdrawalAccount[];
  initialStrategies: WithdrawalStrategy[];
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
  open,
  onOpenChange,
  editing,
  onSaved,
  onRequestDelete,
}: DialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentYear = new Date().getFullYear();
  const isEdit = Boolean(editing);

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
      startYear: data.get("startYear") as string,
      endYear: data.get("endYear") as string,
    };

    try {
      const url = isEdit
        ? `/api/clients/${clientId}/withdrawal-strategy/${editing!.id}`
        : `/api/clients/${clientId}/withdrawal-strategy`;
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to save withdrawal entry");
      }

      const saved = (await res.json()) as WithdrawalStrategy;
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
      <div className="absolute inset-0 bg-black/40" onClick={() => onOpenChange(false)} />
      <div className="relative z-10 w-full max-w-lg rounded-lg border border-gray-700 bg-gray-900 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-100">
            {isEdit ? "Edit Withdrawal Entry" : "Add Withdrawal Entry"}
          </h2>
          <button onClick={() => onOpenChange(false)} className="text-gray-400 hover:text-gray-200">
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
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="ws-start">
                Start Year <span className="text-red-500">*</span>
              </label>
              <input
                id="ws-start"
                name="startYear"
                type="number"
                required
                defaultValue={editing?.startYear ?? currentYear}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="ws-end">
                End Year <span className="text-red-500">*</span>
              </label>
              <input
                id="ws-end"
                name="endYear"
                type="number"
                required
                defaultValue={editing?.endYear ?? currentYear + 30}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
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
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
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
}: WithdrawalStrategySectionProps) {
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
    const res = await fetch(`/api/clients/${clientId}/withdrawal-strategy/${strategyId}`, {
      method: "DELETE",
    });
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
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
            Withdrawal Strategy
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            When household income can&apos;t cover expenses and savings, the projection pulls from
            these accounts in priority order. If left empty, the default order is{" "}
            <span className="font-medium text-gray-400">
              Cash → Taxable → Tax-Deferred → Roth
            </span>{" "}
            (illiquid accounts are skipped).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {list.length > 0 && (
            <button
              onClick={() => setEditMode((v) => !v)}
              className={`rounded-md border px-2.5 py-1 text-[11px] font-medium ${
                editMode
                  ? "border-blue-600 bg-blue-900/40 text-blue-300"
                  : "border-gray-700 bg-gray-900 text-gray-400 hover:bg-gray-800"
              }`}
            >
              {editMode ? "Done" : "Edit"}
            </button>
          )}
          <button
            onClick={() => setDialog({ open: true })}
            disabled={accounts.length === 0}
            className="rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            + Add
          </button>
        </div>
      </header>

      <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900/50">
        {sorted.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-500">
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
                <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gray-800 text-[11px] font-bold text-gray-200">
                  {ws.priorityOrder}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-gray-100">
                    {accountMap[ws.accountId]?.name ?? ws.accountId}
                  </div>
                  <div className="truncate text-xs text-gray-500">
                    {yearsDescriptor(ws.startYear, ws.endYear)}
                  </div>
                </div>
                {editMode && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleting(ws);
                    }}
                    className="text-gray-500 hover:text-red-400"
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

      <WithdrawalDialog
        clientId={clientId}
        accounts={accounts}
        nextPriority={nextPriority}
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
