"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useClientAccess } from "@/components/client-access-provider";
import type { BalanceSheetTab } from "@/components/balance-sheet-report/report-model";
import type { AsOfSelection } from "@/components/balance-sheet-report/year-picker";
import type { EntityFilter } from "@/lib/balance-sheet/entity-groups";

interface BalanceSheetPdfButtonProps {
  clientId: string;
  /** The view on screen — the PDF prints exactly this. */
  tab: BalanceSheetTab;
  asOf: AsOfSelection;
  entityFilter: EntityFilter;
}

export default function BalanceSheetPdfButton({ clientId, tab, asOf, entityFilter }: BalanceSheetPdfButtonProps) {
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);

  async function handleDownload() {
    setBusy(true);
    try {
      const qs = new URLSearchParams({ view: tab, asOf: asOf.mode });
      if (asOf.mode === "eoy") qs.set("year", String(asOf.year));
      if (tab === "entities") qs.set("filter", entityFilter);
      const scenarioParam = searchParams?.get("scenario");
      if (scenarioParam) qs.set("scenario", scenarioParam);
      const res = await fetch(
        `/api/clients/${clientId}/balance-sheet-report/export-pdf?${qs.toString()}`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(`Export failed: HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // An object-URL anchor ignores Content-Disposition; reuse the name the
      // route filed in the vault so the download and the vault copy match.
      a.download =
        /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "balance-sheet.pdf";
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
