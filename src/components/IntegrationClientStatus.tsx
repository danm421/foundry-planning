"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import DialogShell from "@/components/dialog-shell";
import { inputClassName, fieldLabelClassName } from "@/components/forms/input-styles";
import { AlertCircleIcon } from "@/components/icons";
import type { ProviderId } from "@/lib/integrations/types";

interface Props {
  providerId: ProviderId;
  providerLabel: string;
  clientId: string;
  /** Edit permission on THIS client — not an admin role. The routes gate on
   *  client access, so an owning advisor must see these controls and a
   *  view-only share must not. */
  canEdit: boolean;
  /** Whether this client already has a household link. */
  linked: boolean;
  /** ISO string (serialized across the server boundary) or null. */
  lastSyncedAt: string | null;
}

const CLAIM_FORM_ID = "integration-claim-form";

function SyncIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-6.7-3" />
      <path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 6.7 3" />
      <path d="M21 3v5h-5" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

function formatSyncedAt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function IntegrationClientStatus({
  providerId,
  providerLabel,
  clientId,
  canEdit,
  linked,
  lastSyncedAt,
}: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [householdId, setHouseholdId] = useState("");
  const [claimError, setClaimError] = useState<string | null>(null);

  async function handleSync() {
    setBusy(true);
    try {
      const res = await fetch(`/api/integrations/${providerId}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      if (!res.ok) throw new Error("sync failed");
      const { committed, queued } = (await res.json()) as {
        committed: number;
        queued: number;
      };
      showToast({ message: `Synced — ${committed} updated, ${queued} queued for review` });
      router.refresh();
    } catch {
      showToast({ message: "Sync failed. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  function closeDialog() {
    setDialogOpen(false);
    setHouseholdId("");
    setClaimError(null);
  }

  async function handleClaim(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setClaimError(null);
    try {
      const res = await fetch(`/api/integrations/${providerId}/households/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, externalHouseholdId: householdId.trim() }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; name?: string; error?: string }
        | null;
      if (!res.ok) {
        // The server deliberately returns one message for every failure mode
        // (unknown id, already-linked id, lost race) so it can't be used as
        // an oracle for which ids are real. Render it verbatim — never a
        // more specific message, never branched on status code.
        setClaimError(data?.error ?? "Couldn't link that household.");
        return;
      }
      closeDialog();
      showToast({ message: `Linked to ${data?.name ?? providerLabel}.` });
      // The claim itself committed — reflect that regardless of whether the
      // follow-on sync below succeeds. Without this, a failed sync leaves
      // the server-rendered `linked` prop stuck at false; the row keeps
      // offering "Link to {provider}", and pressing it again hits the
      // already-linked branch, returning the opaque "not available" error
      // for an id that is now this client's own.
      router.refresh();
      // Claim only creates the link — pull the accounts as a separate
      // request so one click never holds an accounts+positions fetch open.
      await handleSync();
    } catch {
      setClaimError("Couldn't link that household.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <span className="inline-flex items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 text-ink-2">
          <span
            className={`h-1.5 w-1.5 rounded-full ${linked ? "bg-good" : "bg-ink-4"}`}
            aria-hidden="true"
          />
          {providerLabel}
        </span>
        <span className="text-ink-3">·</span>
        {linked ? (
          lastSyncedAt ? (
            <span className="text-ink-3">
              Synced <span className="tabular">{formatSyncedAt(lastSyncedAt)}</span>
            </span>
          ) : (
            <span className="text-ink-3">Not yet synced</span>
          )
        ) : (
          <span className="text-ink-3">Not linked</span>
        )}
        {linked ? (
          canEdit ? (
            <>
              <button
                type="button"
                className="btn-ghost inline-flex items-center gap-1 text-xs"
                onClick={handleSync}
                disabled={busy}
              >
                <SyncIcon />
                {busy ? "Syncing…" : "Sync"}
              </button>
              <FieldTooltip text={`Updates this household's ${providerLabel}-linked accounts; new accounts are queued for review.`} />
            </>
          ) : null
        ) : canEdit ? (
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => {
              setClaimError(null);
              setHouseholdId("");
              setDialogOpen(true);
            }}
            disabled={busy}
          >
            Link to {providerLabel}
          </button>
        ) : null}
      </span>

      <DialogShell
        open={dialogOpen}
        onOpenChange={(o) => {
          if (!o) closeDialog();
        }}
        title={`Link to ${providerLabel}`}
        size="sm"
        primaryAction={{
          label: busy ? "Linking…" : "Link",
          form: CLAIM_FORM_ID,
          disabled: busy || !householdId.trim(),
        }}
      >
        <form id={CLAIM_FORM_ID} onSubmit={handleClaim}>
          {claimError ? (
            <div
              role="alert"
              className="mb-4 flex items-start gap-2 rounded-[var(--radius-sm)] border border-crit/30 bg-crit/10 px-3 py-2 text-[13px] text-crit"
            >
              <AlertCircleIcon width={16} height={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{claimError}</span>
            </div>
          ) : null}
          <label className={fieldLabelClassName} htmlFor={`${providerId}-household-id`}>
            {providerLabel} household ID
          </label>
          <input
            id={`${providerId}-household-id`}
            className={inputClassName}
            value={householdId}
            onChange={(e) => {
              setHouseholdId(e.target.value);
              setClaimError(null);
            }}
            required
            data-autofocus
          />
        </form>
      </DialogShell>
    </>
  );
}
