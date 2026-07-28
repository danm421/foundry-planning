"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import DialogShell from "@/components/dialog-shell";
import { inputClassName, fieldLabelClassName } from "@/components/forms/input-styles";
import type { RtqContact } from "@/lib/risk/queries";

interface SendRtqDialogProps {
  clientId: string;
  /** Hide the Spouse option when the household has no spouse CRM contact --
   *  matches the resolutions' guidance; rtq-dialog.tsx (Task 11) offers both
   *  unconditionally, a known divergence left for the whole-branch review. */
  hasSpouse: boolean;
  contacts: { primary: RtqContact | null; spouse: RtqContact | null };
}

type Subject = "primary" | "spouse";

function contactName(c: RtqContact | null): string {
  if (!c) return "";
  return `${c.firstName} ${c.lastName}`.trim();
}

/**
 * "Send questionnaire" affordance on the Tolerance card -- emails the client
 * (or spouse) a tokened link to the public RTQ (Task 14 builds the page it
 * opens). Prefills from the household's CRM contact when one exists. Unlike
 * RtqDialog, this dialog owns its own Send button/loading/error state
 * (mirrors ManualToleranceDialog) since there is no shared form component to
 * hand submission to.
 */
export function SendRtqDialog({ clientId, hasSpouse, contacts }: SendRtqDialogProps) {
  const router = useRouter();
  const emailId = useId();
  const nameId = useId();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState<Subject>("primary");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ link: string; delivered: boolean } | null>(null);

  function selectSubject(s: Subject) {
    setSubject(s);
    const contact = s === "primary" ? contacts.primary : contacts.spouse;
    setRecipientEmail(contact?.email ?? "");
    setRecipientName(contactName(contact));
  }

  function openDialog() {
    setError(null);
    setResult(null);
    setSending(false);
    selectSubject("primary");
    setOpen(true);
  }

  async function handleSend() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/risk/send-rtq`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          recipientEmail,
          recipientName: recipientName.trim() || undefined,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: string; link?: string; delivered?: boolean }
        | null;
      if (!res.ok) {
        setError(body?.error ?? "Failed to send.");
        return;
      }
      setResult({ link: body?.link ?? "", delivered: Boolean(body?.delivered) });
      router.refresh();
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="rounded-md border border-hair px-2.5 py-1 text-xs text-ink-2 hover:border-hair-2 hover:text-ink"
      >
        Send questionnaire
      </button>
      <DialogShell
        open={open}
        onOpenChange={setOpen}
        title="Send risk questionnaire"
        size="sm"
        primaryAction={
          result
            ? undefined
            : {
                label: "Send",
                onClick: handleSend,
                disabled: recipientEmail.trim().length === 0,
                loading: sending,
              }
        }
        secondaryAction={result ? { label: "Close", onClick: () => setOpen(false) } : undefined}
      >
        {result ? (
          <div className="space-y-3">
            {result.delivered ? (
              <p className="text-sm text-ink-2">Sent to {recipientEmail}.</p>
            ) : (
              <p className="text-sm text-warn">
                The questionnaire was created, but email delivery is not configured here. Copy
                the link below and send it to the client yourself.
              </p>
            )}
            <div>
              <label className={fieldLabelClassName}>Link</label>
              <input
                type="text"
                readOnly
                value={result.link}
                onFocus={(e) => e.currentTarget.select()}
                className={inputClassName}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="mb-1 text-[13px] font-medium text-ink-2">Who is answering?</legend>
              <div className="flex gap-4">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="send-rtq-subject"
                    value="primary"
                    checked={subject === "primary"}
                    onChange={() => selectSubject("primary")}
                    className="accent-accent"
                  />
                  <span className="text-[13px] text-ink">Primary</span>
                </label>
                {hasSpouse && (
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="send-rtq-subject"
                      value="spouse"
                      checked={subject === "spouse"}
                      onChange={() => selectSubject("spouse")}
                      className="accent-accent"
                    />
                    <span className="text-[13px] text-ink">Spouse</span>
                  </label>
                )}
              </div>
            </fieldset>
            <div>
              <label htmlFor={emailId} className={fieldLabelClassName}>
                Recipient email
              </label>
              <input
                id={emailId}
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                className={inputClassName}
                placeholder="client@example.com"
              />
            </div>
            <div>
              <label htmlFor={nameId} className={fieldLabelClassName}>
                Recipient name (optional)
              </label>
              <input
                id={nameId}
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                className={inputClassName}
              />
            </div>
            {error && (
              <p role="alert" className="text-xs text-crit">
                {error}
              </p>
            )}
          </div>
        )}
      </DialogShell>
    </>
  );
}
