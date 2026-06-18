"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useClientAccess } from "@/components/client-access-provider";

interface BalanceSheetPdfButtonProps {
  clientId: string;
}

export default function BalanceSheetPdfButton({ clientId }: BalanceSheetPdfButtonProps) {
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);

  async function handleDownload() {
    setBusy(true);
    try {
      const year = new Date().getFullYear();
      const scenarioParam = searchParams?.get("scenario");
      const qs = new URLSearchParams({ year: String(year), view: "consolidated", asOf: "today" });
      if (scenarioParam) qs.set("scenario", scenarioParam);
      const res = await fetch(
        `/api/clients/${clientId}/balance-sheet-report/export-pdf?${qs.toString()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ donutPng: null, barPng: null }),
        },
      );
      if (!res.ok) throw new Error(`Export failed: HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `balance-sheet-${year}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) return null;

  return (
    <button
      onClick={handleDownload}
      disabled={busy}
      className="rounded-md border border-hair-2 bg-card px-3 py-1 text-xs font-medium text-ink-2 hover:bg-card-hover disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {busy ? "Generating…" : "Download PDF"}
    </button>
  );
}
