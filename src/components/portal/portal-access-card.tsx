"use client";

import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";

type Status = "not_invited" | "invited" | "active";

interface Props {
  clientId: string;
  status: Status;
  primaryEmail: string;
  invitedAt: Date | null;
  clerkUserId: string | null;
}

export default function PortalAccessCard({
  clientId,
  status,
  primaryEmail,
  invitedAt,
  clerkUserId,
}: Props): ReactElement {
  const router = useRouter();
  const [email, setEmail] = useState(primaryEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setError(null);
    setBusy(true);
    const res = await fetch(`/api/clients/${clientId}/portal/invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({ error: "Failed" }))).error);
      return;
    }
    router.refresh();
  }

  async function revoke() {
    setError(null);
    setBusy(true);
    const res = await fetch(`/api/clients/${clientId}/portal/invite`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError("Failed to revoke invite");
      return;
    }
    router.refresh();
  }

  async function disable() {
    if (!confirm("Disable portal access? The client's login will be deleted.")) return;
    setError(null);
    setBusy(true);
    const res = await fetch(`/api/clients/${clientId}/portal/disable`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      setError("Failed to disable portal access");
      return;
    }
    router.refresh();
  }

  return (
    <section className="rounded-md border border-hair bg-paper p-5">
      <header className="flex items-center justify-between mb-3">
        <h3 className="text-[15px] font-medium text-ink">Access</h3>
        <StatusPill status={status} />
      </header>

      {status === "not_invited" && (
        <div className="flex items-end gap-2">
          <label className="flex-1">
            <span className="block text-[12px] text-ink-3 mb-1">Client email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-hair bg-card-2 px-3 py-1.5 text-[13px] text-ink"
            />
          </label>
          <button
            type="button"
            onClick={send}
            disabled={busy || !email}
            className="rounded-md border border-accent bg-accent/15 px-3 py-1.5 text-[13px] font-medium text-accent disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send invite"}
          </button>
        </div>
      )}

      {status === "invited" && (
        <div className="space-y-2 text-[13px] text-ink-2">
          <p>Invitation sent {invitedAt ? new Date(invitedAt).toLocaleString() : ""}.</p>
          <div className="flex gap-2">
            <button type="button" onClick={send} disabled={busy} className="rounded-md border border-hair px-3 py-1.5 text-ink">
              Resend invite
            </button>
            <button type="button" onClick={revoke} disabled={busy} className="rounded-md border border-bad px-3 py-1.5 text-bad">
              Revoke invite
            </button>
          </div>
        </div>
      )}

      {status === "active" && (
        <div className="space-y-2 text-[13px] text-ink-2">
          <p>Portal user: <span className="text-ink">{clerkUserId}</span></p>
          <button onClick={disable} disabled={busy} className="rounded-md border border-bad px-3 py-1.5 text-bad">
            Disable portal access
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-[12px] text-bad">{error}</p>}
    </section>
  );
}

function StatusPill({ status }: { status: Status }): ReactElement {
  const { label, cls } = {
    not_invited: { label: "Not invited", cls: "border-hair text-ink-3" },
    invited: { label: "Invited", cls: "border-warn text-warn" },
    active: { label: "Active", cls: "border-good text-good" },
  }[status];
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${cls}`}>
      {label}
    </span>
  );
}
