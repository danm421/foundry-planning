"use client";

import { useEffect, useState } from "react";
import DialogShell from "./dialog-shell";
import type { AccountCascadeDependents } from "@/lib/accounts/cascade-dependents";

interface AccountDeleteDialogProps {
  clientId: string;
  /** The account to delete, or null when the dialog is closed. */
  account: { id: string; name: string } | null;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}

/**
 * Account-delete confirmation that warns about cascade loss (audit F15).
 *
 * transfers.source/target_account_id and roth_conversions.destination_account_id
 * are ON DELETE CASCADE, so deleting an account silently deletes that multi-year
 * intent. On open we fetch the dependents and list them by name so the advisor
 * can see exactly what they're about to lose before confirming.
 */
export default function AccountDeleteDialog({
  clientId,
  account,
  onCancel,
  onConfirm,
}: AccountDeleteDialogProps) {
  const [loading, setLoading] = useState(false);
  const [deps, setDeps] = useState<AccountCascadeDependents | null>(null);
  const [depsLoading, setDepsLoading] = useState(false);

  useEffect(() => {
    if (!account) {
      setDeps(null);
      return;
    }
    let cancelled = false;
    setDepsLoading(true);
    setDeps(null);
    fetch(`/api/clients/${clientId}/accounts/${account.id}/dependents`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AccountCascadeDependents | null) => {
        if (!cancelled) setDeps(data);
      })
      .catch(() => {
        if (!cancelled) setDeps(null);
      })
      .finally(() => {
        if (!cancelled) setDepsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, account]);

  if (!account) return null;

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  }

  const cascades = [
    ...(deps?.transfers ?? []).map((t) => ({ kind: "Transfer", name: t.name })),
    ...(deps?.rothConversions ?? []).map((r) => ({ kind: "Roth conversion", name: r.name })),
  ];

  return (
    <DialogShell
      open={!!account}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
      title="Delete Account"
      size="sm"
      destructiveAction={{ label: "Delete", onClick: handleConfirm, loading }}
    >
      <p className="text-[14px] text-ink-2">
        Delete &ldquo;{account.name}&rdquo;? This will also remove any savings rules
        or withdrawal strategies linked to it.
      </p>

      {depsLoading && (
        <p className="mt-3 text-[13px] text-ink-3">Checking for linked transfers and Roth conversions…</p>
      )}

      {!depsLoading && cascades.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-[13px] font-medium text-amber-300">
            Deleting this account will also permanently delete{" "}
            {cascades.length} linked {cascades.length === 1 ? "item" : "items"}:
          </p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[13px] text-ink-2">
            {cascades.map((c, i) => (
              <li key={i}>
                <span className="text-ink-3">{c.kind}:</span> {c.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </DialogShell>
  );
}
