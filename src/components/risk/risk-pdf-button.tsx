"use client";

import { useState } from "react";
import { slugForFilename } from "@/lib/filename-slug";

export function RiskPdfButton({
  clientId,
  householdName,
}: {
  clientId: string;
  householdName: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/risk/export-pdf`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Export failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // An object-URL anchor ignores the response's Content-Disposition, so the
      // name is rebuilt here from the same slug helper the route uses.
      a.download = `risk-profile-${slugForFilename(householdName)}.pdf`;
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
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleDownload}
        disabled={busy}
        className="rounded-md border border-hair px-2.5 py-1 text-xs text-ink-2 hover:border-hair-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Generating…" : "Download PDF"}
      </button>
      {error && (
        <p role="alert" className="text-xs text-crit">
          {error}
        </p>
      )}
    </div>
  );
}
