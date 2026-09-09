"use client";

import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import PortalCard, { portalBtn, portalInput } from "@/components/portal/portal-card";
import { KeyIcon } from "@/components/portal/portal-icons";
import type { PortalAccount } from "@/lib/clients/portal-account";

type Status = "not_invited" | "invited" | "active";

/** What the card renders about the login. Derived from the loader's own type
 *  so the two cannot drift; the Clerk id is passed separately because it is
 *  never rendered as text. `import type` is erased, so pulling this from a
 *  server-only module is safe in a client component. */
export type PortalAccountView = Omit<PortalAccount, "clerkUserId">;

/** Responses from /portal/account, by action. Typed so a server-side rename of
 *  `email` or `revoked` is a compile error here rather than a message that
 *  reads "sent to undefined". */
interface ActionResults {
  send_signin_link: { email?: string };
  sign_out_all: { revoked?: number };
  reset_two_factor: Record<string, never>;
}

interface Props {
  clientId: string;
  status: Status;
  primaryEmail: string;
  invitedAt: Date | null;
  clerkUserId: string | null;
  /** The live Clerk account. Null when Clerk could not be reached — the card
   *  still renders, so "Disable portal access" is never blocked by an outage. */
  account?: PortalAccountView | null;
  /** Household primary contact, used when the client signed up without a name. */
  fallbackName?: string;
}

type Feedback = { kind: "notice" | "error"; text: string };

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(d: Date): string {
  return `${formatDate(d)}, ${new Date(d).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

export default function PortalAccessCard({
  clientId,
  status,
  primaryEmail,
  invitedAt,
  clerkUserId,
  account,
  fallbackName,
}: Props): ReactElement {
  const router = useRouter();
  const [email, setEmail] = useState(primaryEmail);
  const [busy, setBusy] = useState(false);
  // One slot, not an error+notice pair: the card shows at most one message, and
  // two states meant every handler had to remember to clear both.
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  async function send() {
    setFeedback(null);
    setBusy(true);
    const res = await fetch(`/api/clients/${clientId}/portal/invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "Failed" }));
      setFeedback({ kind: "error", text: body.error });
      return;
    }
    router.refresh();
  }

  async function revoke() {
    setFeedback(null);
    setBusy(true);
    const res = await fetch(`/api/clients/${clientId}/portal/invite`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setFeedback({ kind: "error", text: "Failed to revoke invite" });
      return;
    }
    router.refresh();
  }

  async function disable() {
    if (!confirm("Disable portal access? The client's login will be deleted.")) return;
    setFeedback(null);
    setBusy(true);
    const res = await fetch(`/api/clients/${clientId}/portal/disable`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      setFeedback({ kind: "error", text: "Failed to disable portal access" });
      return;
    }
    router.refresh();
  }

  /** Run one account-support action. Each reports in words — an advisor
   *  standing at a button needs to know the client actually got something. */
  async function runAction<A extends keyof ActionResults>(
    action: A,
    said: (data: ActionResults[A]) => string,
  ) {
    setFeedback(null);
    setBusy(true);
    const res = await fetch(`/api/clients/${clientId}/portal/account`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = (await res.json().catch(() => ({}))) as ActionResults[A] & {
      error?: string;
    };
    setBusy(false);
    if (!res.ok) {
      setFeedback({ kind: "error", text: data.error ?? "That did not work. Try again." });
      return;
    }
    setFeedback({ kind: "notice", text: said(data) });
    router.refresh();
  }

  function sendSignInLink() {
    void runAction(
      "send_signin_link",
      (d) =>
        `Sign-in link sent to ${d.email ?? "the client"}. It works once, for an hour.`,
    );
  }

  function signOutEverywhere() {
    if (!confirm("Sign this client out on every device?")) return;
    void runAction("sign_out_all", (d) =>
      d.revoked
        ? `Signed out of ${d.revoked} session${d.revoked === 1 ? "" : "s"}.`
        : "They were not signed in anywhere.",
    );
  }

  function resetTwoFactor() {
    if (
      !confirm("Turn off two-factor for this client? They can set it up again from the portal.")
    )
      return;
    void runAction(
      "reset_two_factor",
      () => "Two-factor removed. They can sign in with their password alone.",
    );
  }

  const displayName = account?.name ?? fallbackName ?? null;
  const displayEmail = account?.email ?? null;

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
        <div className="space-y-5">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-[12px] text-ink-3">Portal user</dt>
              {/* The Clerk id stays out of the text — this page has to be
                  readable with the client in the room — but rides along as a
                  tooltip so support can still quote it. */}
              <dd
                className="mt-1 truncate text-[13px] text-ink"
                title={clerkUserId ?? undefined}
              >
                {displayName ?? displayEmail ?? "Signed up"}
              </dd>
              {displayEmail && displayName && (
                <dd className="tabular truncate text-[12px] text-ink-3">{displayEmail}</dd>
              )}
            </div>
            <div>
              <dt className="text-[12px] text-ink-3">Last sign-in</dt>
              <dd className="tabular mt-1 text-[13px] text-ink-2">
                {account?.lastSignInAt ? formatDateTime(account.lastSignInAt) : "Never"}
              </dd>
            </div>
            {invitedAt && (
              <div>
                <dt className="text-[12px] text-ink-3">Invited</dt>
                <dd className="tabular mt-1 text-[13px] text-ink-2">{formatDate(invitedAt)}</dd>
              </div>
            )}
            {account && (
              <div>
                <dt className="text-[12px] text-ink-3">Two-factor</dt>
                <dd className="mt-1 text-[13px] text-ink-2">
                  {account.twoFactorEnabled ? "On" : "Off"}
                </dd>
              </div>
            )}
          </dl>

          {account?.locked && (
            <p className="text-[13px] text-warn">
              Locked after repeated failed sign-ins. A sign-in link gets them
              back in without waiting for the lock to clear.
            </p>
          )}

          {!account && (
            <p className="text-[13px] text-ink-3">
              Sign-in details are unavailable right now, so the account actions
              are turned off. Disabling access still works.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={sendSignInLink}
              disabled={busy || !account}
              className={portalBtn.accent}
            >
              Send sign-in link
            </button>
            <button
              type="button"
              onClick={signOutEverywhere}
              disabled={busy || !account}
              className={portalBtn.ghost}
            >
              Sign out everywhere
            </button>
            {account?.twoFactorEnabled && (
              <button
                type="button"
                onClick={resetTwoFactor}
                disabled={busy}
                className={portalBtn.ghost}
              >
                Reset two-factor
              </button>
            )}
            <button type="button" onClick={disable} disabled={busy} className={portalBtn.danger}>
              Disable portal access
            </button>
          </div>
        </div>
      )}

      {feedback && (
        <p
          className={`mt-3 text-[12px] ${feedback.kind === "error" ? "text-crit" : "text-good"}`}
        >
          {feedback.text}
        </p>
      )}
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
