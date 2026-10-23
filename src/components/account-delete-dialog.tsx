"use client";

import { useState } from "react";
import DialogShell from "./dialog-shell";
import { AccountCascadeList, useAccountCascadeDependents } from "./account-cascade-dependents";

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
  const { deps, loading: depsLoading } = useAccountCascadeDependents(clientId, account?.id ?? null);

  if (!account) return null;

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  }

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

      <AccountCascadeList deps={deps} loading={depsLoading} action="Deleting this account" />
    </DialogShell>
  );
}
