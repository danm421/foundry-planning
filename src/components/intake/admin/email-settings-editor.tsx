"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildIntakeEmailHtml,
  buildIntakeFromHeader,
  resolveSubject,
} from "@/lib/intake/email-template";
import {
  DEFAULT_INTAKE_SUBJECT,
  DEFAULT_INTAKE_INTRO,
} from "@/lib/intake/defaults";

type Props = {
  initial: { fromName: string; subject: string; introBody: string };
  advisorName: string;
  advisorEmail: string;
  firmName: string;
};

const SAMPLE_CLIENT = "Jordan Sample";
const PREVIEW_LINK = "https://app.foundryplanning.com/intake/preview";

export default function EmailSettingsEditor({ initial, advisorName, advisorEmail, firmName }: Props) {
  const router = useRouter();
  const [fromName, setFromName] = useState(initial.fromName);
  const [subject, setSubject] = useState(initial.subject);
  const [introBody, setIntroBody] = useState(initial.introBody);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewHtml = useMemo(
    () =>
      buildIntakeEmailHtml({
        link: PREVIEW_LINK,
        introBody: introBody || undefined,
        advisorName,
        advisorEmail,
        firmName,
        clientName: SAMPLE_CLIENT,
      }),
    [introBody, advisorName, advisorEmail, firmName],
  );
  const previewFrom = buildIntakeFromHeader(fromName || undefined, firmName || undefined);
  const previewSubject = resolveSubject(subject || undefined);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/data-collection/email-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromName, subject, introBody }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError((b as { error?: string }).error ?? "Failed to save.");
        return;
      }
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-full rounded-[var(--radius-sm)] border border-hair bg-paper px-3 py-2 text-[14px] text-ink outline-none focus:border-accent";

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Form */}
      <div className="rounded-[var(--radius-sm)] border border-hair bg-card p-5">
        <div className="flex flex-col gap-4">
          <div>
            <label htmlFor="es-from" className="block mb-1 text-[12px] text-ink-3">From name</label>
            <input id="es-from" type="text" value={fromName} onChange={(e) => setFromName(e.target.value)}
              placeholder={firmName || "Foundry"} className={inputCls} />
            <p className="mt-1 text-[11px] text-ink-4">Shown as the sender. Sent from noreply@foundryplanning.com.</p>
          </div>
          <div>
            <label htmlFor="es-subject" className="block mb-1 text-[12px] text-ink-3">Subject</label>
            <input id="es-subject" type="text" value={subject} onChange={(e) => setSubject(e.target.value)}
              placeholder={DEFAULT_INTAKE_SUBJECT} className={inputCls} />
          </div>
          <div>
            <label htmlFor="es-intro" className="block mb-1 text-[12px] text-ink-3">Intro message</label>
            <textarea id="es-intro" rows={6} value={introBody} onChange={(e) => setIntroBody(e.target.value)}
              placeholder={DEFAULT_INTAKE_INTRO} className={`${inputCls} resize-y`} />
            <p className="mt-1 text-[11px] text-ink-4">
              Tokens: <code>{"{{advisorName}}"}</code> <code>{"{{firmName}}"}</code> <code>{"{{clientName}}"}</code>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={handleSave} disabled={saving}
              className="btn-primary shrink-0 rounded-[var(--radius-sm)] bg-accent px-5 py-2 text-[14px] font-medium text-accent-on transition-opacity hover:opacity-90 disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>
            {saved && <span role="status" className="text-[13px] text-green-700">Saved.</span>}
            {error && <span role="alert" className="text-[13px] text-red-600">{error}</span>}
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className="rounded-[var(--radius-sm)] border border-hair bg-card p-5">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-4">Preview</h2>
        <div className="mb-3 rounded-[var(--radius-sm)] border border-hair bg-paper px-3 py-2 text-[12px] text-ink-3">
          <div><span className="text-ink-4">From:</span> {previewFrom}</div>
          <div><span className="text-ink-4">Subject:</span> {previewSubject}</div>
        </div>
        <div data-testid="email-preview" className="overflow-auto rounded-[var(--radius-sm)] bg-white p-3"
          dangerouslySetInnerHTML={{ __html: previewHtml }} />
      </div>
    </div>
  );
}
