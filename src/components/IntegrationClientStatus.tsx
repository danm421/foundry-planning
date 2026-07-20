"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import type { ProviderId } from "@/lib/integrations/types";

interface Props {
  providerId: ProviderId;
  providerLabel: string;
  clientId: string;
  isAdmin: boolean;
  /** ISO string (serialized across the server boundary) or null. */
  lastSyncedAt: string | null;
}

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
  isAdmin,
  lastSyncedAt,
}: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

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

  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <span className="inline-flex items-center gap-1.5 text-ink-2">
        <span className="h-1.5 w-1.5 rounded-full bg-good" aria-hidden="true" />
        {providerLabel}
      </span>
      <span className="text-ink-3">·</span>
      {lastSyncedAt ? (
        <span className="text-ink-3">
          Synced <span className="tabular">{formatSyncedAt(lastSyncedAt)}</span>
        </span>
      ) : (
        <span className="text-ink-3">Not yet synced</span>
      )}
      {isAdmin ? (
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
      ) : null}
    </span>
  );
}
