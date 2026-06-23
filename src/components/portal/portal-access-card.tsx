"use client";

import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import PortalCard, { portalBtn, portalInput } from "@/components/portal/portal-card";
import { KeyIcon } from "@/components/portal/portal-icons";

type Status = "not_invited" | "invited" | "active";

interface Props {
  clientId: string;
  status: Status;
  primaryEmail: string;
  invitedAt: Date | null;
  clerkUserId: string | null;
}

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
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
    <PortalCard
      icon={<KeyIcon />}
      title="Portal access"
      action={<StatusPill status={status} />}
    >
      {status === "not_invited" && (
        <div className="flex items-end gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-[12px] text-ink-3">Client email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={portalInput}
            />
          </label>
          <button type="button" onClick={send} disabled={busy || !email} className={portalBtn.primary}>
            {busy ? "Sending…" : "Send invite"}
          </button>
        </div>
      )}

      {status === "invited" && (
        <div className="space-y-3">
          <p className="text-[13px] text-ink-2">
            Invitation sent{invitedAt ? <> {formatDate(invitedAt)}</> : ""}. Awaiting sign-up.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={send} disabled={busy} className={portalBtn.ghost}>
              Resend invite
            </button>
            <button type="button" onClick={revoke} disabled={busy} className={portalBtn.danger}>
              Revoke invite
            </button>
          </div>
        </div>
      )}

      {status === "active" && (
        <div className="space-y-4">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-6 gap-y-2 text-[13px]">
            <dt className="text-ink-3">Portal user</dt>
            <dd className="tabular min-w-0 truncate text-ink" title={clerkUserId ?? undefined}>
              {clerkUserId}
            </dd>
            {invitedAt && (
              <>
                <dt className="text-ink-3">Invited</dt>
                <dd className="tabular text-ink-2">{formatDate(invitedAt)}</dd>
              </>
            )}
          </dl>
          <button type="button" onClick={disable} disabled={busy} className={portalBtn.danger}>
            Disable portal access
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-[12px] text-crit">{error}</p>}
    </PortalCard>
  );
}

function StatusPill({ status }: { status: Status }): ReactElement {
  const { label, cls } = {
    not_invited: { label: "Not invited", cls: "border-hair text-ink-3" },
    invited: { label: "Invited", cls: "border-warn/40 text-warn" },
    active: { label: "Active", cls: "border-good/40 text-good" },
  }[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${cls}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
