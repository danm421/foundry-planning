"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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
    <div className="rounded-md border border-hair bg-card-2 p-4">
      <div className="text-[14px] font-medium text-ink">Send intake form</div>
      <div className="mt-0.5 text-[12px] text-ink-3">
        Send a data-collection form to this client. Choose blank for a clean
        slate or pre-filled to seed responses from their current plan.
      </div>

      <div className="mt-3">
        <label htmlFor="recipient-email" className="block mb-1 text-[12px] text-ink-3">
          Recipient email
        </label>
        <div className="flex items-center gap-2">
          <input
            id="recipient-email"
            type="email"
            value={recipientEmail}
            onChange={(e) => setRecipientEmail(e.target.value)}
            className="flex-1 rounded-[var(--radius-sm)] border border-hair bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
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

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={sending}
          onClick={() => send("blank")}
          className="inline-flex items-center rounded-[var(--radius-sm)] border border-hair bg-paper px-3 py-1.5 text-[13px] font-medium text-ink transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send blank form"}
        </button>
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            disabled={sending}
            onClick={() => send("prefilled")}
            className="inline-flex items-center rounded-[var(--radius-sm)] bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-on transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send pre-filled form"}
          </button>
          {clientAlreadyBound && (
            <span className="text-[11px] text-ink-4">
              Client already has portal access — no new invite will be sent.
            </span>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-[12px] text-red-600">
          {error}
        </p>
      )}
      {successMsg && (
        <p role="status" className="mt-2 text-[12px] text-ink">
          {successMsg}
        </p>
      )}

      {pendingFormId && (
        <div className="mt-3 flex items-center gap-2">
          <span className="chip rounded-full border border-hair bg-card px-2 py-0.5 text-[11px] text-ink-3">
            Submitted
          </span>
          <Link
            href={`/data-collection/${pendingFormId}`}
            className="text-[12px] text-ink-2 hover:underline"
          >
            Submitted form awaiting review
          </Link>
        </div>
      )}
    </div>
  );
}
