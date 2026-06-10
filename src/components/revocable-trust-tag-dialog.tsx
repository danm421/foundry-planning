// src/components/revocable-trust-tag-dialog.tsx
"use client";

import { useState } from "react";
import DialogShell from "./dialog-shell";
import type { AccountLite } from "./family-view";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Account categories eligible to be tagged into a revocable trust. */
const ELIGIBLE_CATEGORIES = new Set(["cash", "taxable", "real_estate"]);

export interface RevocableTrustTagDialogProps {
  clientId: string;
  /** When provided, dialog is in edit mode — fields pre-populated. */
  editing?: {
    id: string;
    name: string;
    accountIds: string[];
  };
  /** The full account list from family-view. Only eligible categories are shown. */
  accounts: AccountLite[];
  /** Called after a successful POST (create) or PATCH (edit). */
  onSaved: (trust: { id: string; name: string; accountIds: string[] }) => void;
  /** Called when the dialog should close (Cancel, backdrop, Esc, post-delete). */
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RevocableTrustTagDialog({
  clientId,
  editing,
  accounts,
  onSaved,
  onClose,
}: RevocableTrustTagDialogProps) {
  const isEdit = Boolean(editing);

  const [name, setName] = useState(editing?.name ?? "");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(editing?.accountIds ?? [])
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligibleAccounts = accounts.filter((a) =>
    ELIGIBLE_CATEGORIES.has(a.category)
  );

  // ── Handlers ────────────────────────────────────────────────────────────────

  function toggleAccount(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Trust name is required.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const accountIds = Array.from(selectedIds);
      const body = { name: trimmedName, accountIds };

      const url = isEdit
        ? `/api/clients/${clientId}/revocable-trusts/${editing!.id}`
        : `/api/clients/${clientId}/revocable-trusts`;

      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "Failed to save trust.");
        return;
      }

      const saved = (await res.json()) as { id: string; name: string; accountIds: string[] };
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/clients/${clientId}/revocable-trusts/${editing.id}`,
        { method: "DELETE" }
      );

      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "Failed to delete trust.");
        setLoading(false);
        return;
      }

      onSaved({ id: editing.id, name: editing.name, accountIds: [] });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setLoading(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <DialogShell
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={isEdit ? "Edit Revocable Trust" : "Add Revocable Trust"}
      size="sm"
      primaryAction={{
        label: isEdit ? "Save Changes" : "Add Trust",
        onClick: handleSave,
        disabled: loading || !name.trim(),
        loading,
      }}
      secondaryAction={{
        label: "Cancel",
        onClick: onClose,
      }}
      destructiveAction={
        isEdit
          ? { label: "Delete", onClick: handleDelete, disabled: loading }
          : undefined
      }
    >
      <div className="flex flex-col gap-5">
        {/* Trust name */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="trust-name" className="text-[13px] font-medium text-ink-2">
            Trust name
          </label>
          <input
            id="trust-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Smith Family Revocable Trust"
            disabled={loading}
            autoFocus
            className="w-full rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2 text-[14px] text-ink placeholder:text-ink-4 focus:border-ink-3 focus:outline-none disabled:opacity-50"
          />
        </div>

        {/* Eligible accounts */}
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-medium text-ink-2">
            Accounts in this trust
          </p>
          {eligibleAccounts.length === 0 ? (
            <p className="text-[13px] text-ink-3">
              No eligible accounts (cash, taxable, or real estate) found.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {eligibleAccounts.map((acct) => {
                const checked = selectedIds.has(acct.id);
                return (
                  <li key={acct.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 hover:bg-card-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAccount(acct.id)}
                        disabled={loading}
                        className="h-4 w-4 rounded accent-accent disabled:opacity-50"
                      />
                      <span className="text-[14px] text-ink">{acct.name}</span>
                      <span className="ml-auto text-[12px] text-ink-4">
                        {CATEGORY_LABEL[acct.category] ?? acct.category}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Inline error */}
        {error && (
          <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}
      </div>
    </DialogShell>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<string, string> = {
  cash: "Cash",
  taxable: "Taxable",
  real_estate: "Real Estate",
};
