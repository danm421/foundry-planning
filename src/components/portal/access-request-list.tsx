"use client";

import { useCallback, useEffect, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { portalBtn } from "@/components/portal/portal-card";

/** One row of `GET /api/portal/requests`. `expiresAt` arrives as JSON, so it is
 *  an ISO string here, not a Date; null means the request never expires. */
export interface AccessRequest {
  bindingId: string;
  firmName: string;
  advisorName: string | null;
  householdName: string;
  expiresAt: string | null;
}

type Load = { state: "loading" } | { state: "error" } | { state: "ready"; requests: AccessRequest[] };

/**
 * The reader's LOCAL day, deliberately — unlike `fmtDay`, which UTC-pins a
 * date-only string. `expires_at` is a `timestamptz`: a real instant (the
 * request plus its TTL), not a calendar date. Pinning it to UTC would tell a
 * client west of Greenwich they have until a day the request is already dead
 * on. Rendering locally can only ever be exact or a few hours conservative.
 */
function fmtExpiry(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The client's accept / decline screen for a firm's portal access request.
 *
 * Deliberately fetches rather than taking server-loaded props: accepting or
 * declining changes the list in place, and a client component that owns the
 * list can drop a declined row without a round trip through a server render
 * this page has no layout to re-run.
 */
export default function AccessRequestList(): ReactElement {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const res = await fetch("/api/portal/requests");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { requests: AccessRequest[] };
      setLoad({ state: "ready", requests: data.requests });
    } catch {
      setLoad({ state: "error" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function decide(bindingId: string, action: "accept" | "decline") {
    setBusyId(bindingId);
    setError(null);
    try {
      const res = await fetch("/api/portal/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bindingId, action }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Try again in a moment.");
        // A 404 or 409 means the row moved on without us — re-read rather than
        // leaving a button the client can keep pressing at a settled request.
        if (res.status === 404 || res.status === 409) void refresh();
        return;
      }
      if (action === "accept") {
        router.push("/portal/organizer");
        return;
      }
      setLoad((prev) =>
        prev.state === "ready"
          ? { state: "ready", requests: prev.requests.filter((r) => r.bindingId !== bindingId) }
          : prev,
      );
    } catch {
      setError("Something went wrong. Try again in a moment.");
    } finally {
      setBusyId(null);
    }
  }

  if (load.state === "loading") {
    return <p className="text-[13px] text-ink-3">Loading your requests&hellip;</p>;
  }

  if (load.state === "error") {
    return (
      <div className="rounded-xl border border-hair bg-card p-6">
        <p className="text-[13px] leading-relaxed text-ink-2">
          We couldn&rsquo;t load your requests just now.
        </p>
        <button type="button" onClick={() => void refresh()} className={`${portalBtn.ghost} mt-4`}>
          Try again
        </button>
      </div>
    );
  }

  if (load.requests.length === 0) {
    return (
      <div className="rounded-xl border border-hair bg-card p-6">
        <p className="text-[13px] leading-relaxed text-ink-2">You have no pending requests.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p role="alert" className="text-[13px] leading-relaxed text-crit">
          {error}
        </p>
      ) : null}

      {load.requests.map((r) => (
        <section key={r.bindingId} className="rounded-xl border border-hair bg-card p-6">
          <h2 className="text-[15px] font-semibold text-ink">{r.firmName}</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
            {r.advisorName ? `${r.advisorName} at ${r.firmName}` : r.firmName} would like to
            connect your Foundry account to {r.householdName}.
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-3">
            Accepting lets you open that household from your portal. You can disconnect it
            later from your portal settings.
          </p>
          {r.expiresAt ? (
            <p className="mt-2 text-[13px] leading-relaxed text-ink-3">
              This request expires on {fmtExpiry(r.expiresAt)}.
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              className={portalBtn.primary}
              disabled={busyId === r.bindingId}
              onClick={() => void decide(r.bindingId, "accept")}
            >
              Accept
            </button>
            <button
              type="button"
              className={portalBtn.ghost}
              disabled={busyId === r.bindingId}
              onClick={() => void decide(r.bindingId, "decline")}
            >
              Decline
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
