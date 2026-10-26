"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";
import { ByokConnectForm } from "@/components/IntegrationConnectionCard";
import type { ProviderAuthKind, SyncingProviderId } from "@/lib/integrations/types";

type ConnectionStatus = "connected" | "disconnected" | "error";

interface Props {
  providerId: SyncingProviderId;
  label: string;
  authKind: ProviderAuthKind;
  connections: Array<{
    id: string;
    name: string;
    status: ConnectionStatus;
    /** ISO string (serialized across the server boundary) or null. */
    lastSyncedAt: string | null;
    linkedHouseholds: number;
  }>;
}

const STATUS: Record<ConnectionStatus, { dot: string; label: string }> = {
  connected: { dot: "bg-good", label: "Connected" },
  error: { dot: "bg-warn", label: "Reconnect needed" },
  disconnected: { dot: "bg-ink-4", label: "Not connected" },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * The caller's own connections to one provider, one row each, and the way to
 * add another. A BYOK provider (Addepar) can hold several, so it always offers
 * "Add another"; an OAuth provider holds one per advisor, so it offers Connect
 * only while there is none.
 */
export function IntegrationConnectionList({ providerId, label, authKind, connections }: Props) {
  const [adding, setAdding] = useState(false);
  const none = connections.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {none ? null : (
        <ul className="divide-y divide-hair overflow-hidden rounded border border-hair bg-card">
          {connections.map((c) => (
            <li key={c.id}>
              <Link
                href={`/settings/integrations/${providerId}/${c.id}`}
                className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-card-2 focus-visible:bg-card-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium text-ink">{c.name}</span>
                  <span className="text-xs text-ink-3">
                    <span className="tabular">{c.linkedHouseholds}</span>{" "}
                    {c.linkedHouseholds === 1 ? "household" : "households"} linked
                    {c.status === "connected" && c.lastSyncedAt ? (
                      <>
                        {" · Last synced "}
                        <span className="tabular">{formatDate(c.lastSyncedAt)}</span>
                      </>
                    ) : null}
                  </span>
                </div>
                <span className="inline-flex shrink-0 items-center gap-2 text-sm text-ink-2">
                  <span className={`h-2 w-2 rounded-full ${STATUS[c.status].dot}`} aria-hidden="true" />
                  {STATUS[c.status].label}
                </span>
                <ChevronRightIcon
                  width={16}
                  height={16}
                  className="shrink-0 text-ink-4 transition-colors group-hover:text-ink"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {authKind === "byok" ? (
        <section className="flex flex-col gap-3 rounded border border-hair bg-card p-4">
          {none || adding ? (
            <>
              <p className="text-sm text-ink-3">
                Connect your {label} account to sync household accounts and holdings into Foundry.
              </p>
              <ByokConnectForm providerId={providerId} label={label} />
            </>
          ) : (
            <div>
              <button type="button" className="btn-ghost text-sm" onClick={() => setAdding(true)}>
                Add another {label} connection
              </button>
            </div>
          )}
        </section>
      ) : none ? (
        <section className="flex flex-col gap-3 rounded border border-hair bg-card p-4">
          <p className="text-sm text-ink-3">
            Connect your {label} account to sync household accounts and holdings into Foundry.
          </p>
          <div>
            <a className="btn-primary" href={`/api/integrations/${providerId}/connect`}>
              Connect {label}
            </a>
          </div>
        </section>
      ) : null}
    </div>
  );
}
