"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EMAIL_RE } from "@/lib/intake/schema";
import PortalCard, { portalBtn, portalInput } from "@/components/portal/portal-card";
import { MailIcon } from "@/components/portal/portal-icons";

interface Props {
  clientId: string;
  primaryEmail: string;
  spouseEmail?: string;
  primaryName?: string;
  spouseName?: string;
  clientAlreadyBound: boolean;
  pendingFormId: string | null;
}

export default function SendClientForm({
  clientId,
  primaryEmail,
  spouseEmail,
  primaryName,
  spouseName,
  clientAlreadyBound,
  pendingFormId,
}: Props) {
  const router = useRouter();
  const [recipientEmail, setRecipientEmail] = useState(primaryEmail);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  async function send(mode: "blank" | "prefilled") {
    setError(null);
    setSuccessMsg(null);

    if (!EMAIL_RE.test(recipientEmail)) {
      setError("Please enter a valid email address.");
      return;
    }

    setSending(true);
    try {
      const recipientName =
        spouseEmail && recipientEmail === spouseEmail
          ? (spouseName ?? primaryName)
          : primaryName;

      const res = await fetch("/api/data-collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          clientId,
          recipientEmail,
          recipientName,
        }),
      });

      if (res.status === 429) {
        setError("Rate limit — try again later.");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? "Failed to send intake form.");
        return;
      }

      setSuccessMsg(`Form sent to ${recipientEmail}.`);
      router.refresh();
    } finally {
      setSending(false);
    }
  }

  return (
    <PortalCard
      icon={<MailIcon />}
      title="Send intake form"
      description="Send a data-collection form to this client. Choose blank for a clean slate or pre-filled to seed responses from their current plan."
    >
      <div>
        <label htmlFor="recipient-email" className="mb-1 block text-[12px] text-ink-3">
          Recipient email
        </label>
        <div className="flex items-center gap-2">
          <input
            id="recipient-email"
            type="email"
            value={recipientEmail}
            onChange={(e) => setRecipientEmail(e.target.value)}
            className={portalInput}
          />
          {spouseEmail && spouseEmail !== recipientEmail && (
            <button
              type="button"
              onClick={() => setRecipientEmail(spouseEmail)}
              className="shrink-0 text-[12px] text-accent hover:underline"
            >
              Use spouse email
            </button>
          )}
          {spouseEmail && spouseEmail === recipientEmail && primaryEmail && primaryEmail !== spouseEmail && (
            <button
              type="button"
              onClick={() => setRecipientEmail(primaryEmail)}
              className="shrink-0 text-[12px] text-accent hover:underline"
            >
              Use primary email
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" disabled={sending} onClick={() => send("blank")} className={portalBtn.ghost}>
          {sending ? "Sending…" : "Send blank form"}
        </button>
        <button type="button" disabled={sending} onClick={() => send("prefilled")} className={portalBtn.primary}>
          {sending ? "Sending…" : "Send pre-filled form"}
        </button>
      </div>
      {clientAlreadyBound && (
        <p className="mt-2 text-[11px] text-ink-4">
          Client already has portal access — no new invite will be sent.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 text-[12px] text-crit">
          {error}
        </p>
      )}
      {successMsg && (
        <p role="status" className="mt-3 text-[12px] text-good">
          {successMsg}
        </p>
      )}

      {pendingFormId && (
        <div className="mt-4 flex items-center gap-2 border-t border-hair pt-3">
          <span className="chip">Submitted</span>
          <Link
            href={`/data-collection/${pendingFormId}`}
            className="text-[12px] text-ink-2 hover:text-ink hover:underline"
          >
            Submitted form awaiting review
          </Link>
        </div>
      )}
    </PortalCard>
  );
}
