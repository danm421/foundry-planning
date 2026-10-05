"use client";

import { useState } from "react";
import { DownloadIcon } from "@/components/icons";
import { filenameFromContentDisposition } from "@/components/portal/documents/vault-format";

/** Downloads a submitted form's answers as a PDF. */
export function AnswersPdfButton({ formId }: { formId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/data-collection/${formId}/export-pdf`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Export failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // An object-URL anchor ignores Content-Disposition, so the route's name
      // is read off the header and set here.
      a.download =
        filenameFromContentDisposition(res.headers.get("Content-Disposition")) ??
        "data-collection.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleDownload}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-hair px-3 py-1.5 text-[13px] text-ink-2 transition-colors hover:border-hair-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
      >
        <DownloadIcon width={14} height={14} aria-hidden="true" />
        {busy ? "Generating…" : "Download PDF"}
      </button>
      {error && (
        <p role="alert" className="text-[12px] text-crit">
          {error}
        </p>
      )}
    </div>
  );
}
