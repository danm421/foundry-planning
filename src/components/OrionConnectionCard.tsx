"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { FieldTooltip } from "@/components/forms/field-tooltip";

type OrionStatus = "connected" | "disconnected" | "error";

interface Props {
  status: OrionStatus;
  /** ISO string (serialized across the server boundary) or null. */
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

/** Refresh / sync arrows — minimal outline, inherits text color. */
function SyncIcon() {
  return (
    <svg
      width="16"
      height="16"
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

function StatusPip({ status }: { status: OrionStatus }) {
  const dot =
    status === "connected"
      ? "bg-good"
      : status === "error"
        ? "bg-warn"
        : "bg-ink-4";
  const label =
    status === "connected"
      ? "Connected"
      : status === "error"
        ? "Reconnect needed"
        : "Not connected";
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-2">
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}

function formatSyncedAt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function OrionConnectionCard({ status, lastSyncedAt, lastSyncError }: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState<"sync" | "disconnect" | null>(null);

  async function handleSync() {
    setBusy("sync");
    try {
      const res = await fetch("/api/integrations/orion/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
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
      setBusy(null);
    }
  }

  async function handleDisconnect() {
    setBusy("disconnect");
    try {
      const res = await fetch("/api/integrations/orion/disconnect", { method: "POST" });
      if (!res.ok) throw new Error("disconnect failed");
      router.refresh();
    } catch {
      showToast({ message: "Couldn't disconnect. Please try again." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded border border-hair bg-card p-4">
      <div className="flex items-center justify-between gap-4">
        <StatusPip status={status} />
        {status === "connected" && lastSyncedAt ? (
          <span className="text-xs text-ink-3">
            Last synced <span className="tabular">{formatSyncedAt(lastSyncedAt)}</span>
          </span>
        ) : null}
      </div>

      {status === "disconnected" ? (
        <>
          <p className="text-sm text-ink-3">
            Connect your Orion account to sync household accounts and holdings into Foundry.
          </p>
          <div>
            <a className="btn-primary" href="/api/integrations/orion/connect">
              Connect Orion
            </a>
          </div>
        </>
      ) : null}

      {status === "error" ? (
        <>
          <p className="text-sm text-ink-3">
            Foundry can no longer reach Orion. Reconnect to resume syncing.
            {lastSyncError ? ` (${lastSyncError})` : ""}
          </p>
          <div>
            <a className="btn-primary" href="/api/integrations/orion/connect">
              Reconnect Orion
            </a>
          </div>
        </>
      ) : null}

      {status === "connected" ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn-primary text-sm"
            onClick={handleSync}
            disabled={busy !== null}
          >
            <SyncIcon />
            {busy === "sync" ? "Syncing…" : "Sync now"}
          </button>
          <FieldTooltip text="Pulls accounts and holdings from linked Orion households. Existing accounts update in place; new ones are queued for your review before they touch a plan." />
          <button
            type="button"
            className="btn-ghost text-sm"
            onClick={handleDisconnect}
            disabled={busy !== null}
          >
            {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
