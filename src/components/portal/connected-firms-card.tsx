"use client";

import { useCallback, useEffect, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { portalBtn } from "@/components/portal/portal-card";

/** One row of `GET /api/portal/connections`. `since` arrives as JSON, so it is
 *  an ISO string here, not a Date; null means no acceptance was recorded. */
export interface PortalConnection {
  clientId: string;
  firmName: string;
  householdName: string;
  since: string | null;
}

/**
 * Both consequences, plainly, before anything is written: what the client
 * loses, what they keep, and what it takes to come back. Disconnecting is
 * immediate and only the firm can undo it.
 */
export const DISCONNECT_CONFIRM =
  "Disconnect from this firm? You'll lose access to this household's documents and plan " +
  "immediately. Your login and your other connections are unaffected. To return, your " +
  "advisor will need to send a new request.";

type Load =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; connections: PortalConnection[] };

/**
 * The reader's LOCAL day, deliberately. `accepted_at` is a `timestamptz` — a
 * real instant — so UTC-pinning it would print the wrong calendar day for
 * anyone west of Greenwich. Same reasoning as `fmtExpiry` on the access-request
 * screen.
 */
function fmtSince(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The firms holding this login, and the client's own Disconnect.
 *
 * Fetches rather than taking server-loaded props for the same reason the
 * access-request screen does: disconnecting changes the list in place, and a
 * component that owns the list can drop the row it just ended without waiting
 * on a server render.
 *
 * A successful disconnect ALSO refreshes the route. Everything else on the
 * Settings screen — the privacy toggles, the linked institutions — belongs to
 * the client's *active* household, which is the very household they may have
 * just left; leaving that on screen would show them settings for a household
 * they can no longer open.
 */
export default function ConnectedFirmsCard(): ReactElement {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const res = await fetch("/api/portal/connections");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { connections: PortalConnection[] };
      setLoad({ state: "ready", connections: data.connections });
    } catch {
      setLoad({ state: "error" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function disconnect(clientId: string) {
    if (!window.confirm(DISCONNECT_CONFIRM)) return;
    setBusyId(clientId);
    setError(null);
    try {
      const res = await fetch("/api/portal/connections", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Try again in a moment.");
        return;
      }
      setLoad((prev) =>
        prev.state === "ready"
          ? { state: "ready", connections: prev.connections.filter((c) => c.clientId !== clientId) }
          : prev,
      );
      router.refresh();
    } catch {
      setError("Something went wrong. Try again in a moment.");
    } finally {
      setBusyId(null);
    }
  }

  let body: ReactElement;
  if (load.state === "loading") {
    body = <p className="text-[13px] text-ink-3">Loading your connections&hellip;</p>;
  } else if (load.state === "error") {
    body = (
      <div>
        <p className="text-[13px] leading-relaxed text-ink-2">
          We couldn&rsquo;t load your connections just now.
        </p>
        <button type="button" onClick={() => void refresh()} className={`${portalBtn.ghost} mt-3`}>
          Try again
        </button>
      </div>
    );
  } else if (load.connections.length === 0) {
    body = (
      <p className="text-[13px] leading-relaxed text-ink-2">
        No firms are connected to your login.
      </p>
    );
  } else {
    body = (
      <ul className="divide-y divide-hair rounded-lg border border-hair">
        {load.connections.map((c) => (
          <li
            key={c.clientId}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-ink">{c.firmName}</p>
              <p className="truncate text-[12px] text-ink-3">
                {c.householdName}
                {c.since ? ` · Connected since ${fmtSince(c.since)}` : ""}
              </p>
            </div>
            <button
              type="button"
              className={portalBtn.danger}
              disabled={busyId === c.clientId}
              onClick={() => void disconnect(c.clientId)}
            >
              Disconnect
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p role="alert" className="text-[13px] leading-relaxed text-crit">
          {error}
        </p>
      ) : null}
      {body}
    </div>
  );
}
