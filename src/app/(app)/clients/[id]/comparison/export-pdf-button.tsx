"use client";

import { useState } from "react";
import type { ComparisonLayoutV5 } from "@/lib/comparison/layout-schema";
import { captureCellImages } from "./capture-cell-images";
import type { CanvasMode } from "./mode-toggle";

interface Props {
  clientId: string;
  comparisonId: string;
  layout: ComparisonLayoutV5;
  mode: CanvasMode;
  setMode: (m: CanvasMode) => void;
  mcReady: boolean;
}

export function ExportPdfButton({ clientId, comparisonId, layout, mode, setMode, mcReady }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      if (mode !== "preview") {
        setMode("preview");
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      // Give Chart.js a tick to finish drawing into the canvas after preview-mode mount.
      await new Promise((r) => setTimeout(r, 250));

      const chartImages = await captureCellImages(layout);

      const res = await fetch(
        `/api/clients/${clientId}/comparison/${comparisonId}/export-pdf`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chartImages }),
        },
      );
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);

      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? "comparison.pdf";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy || !mcReady}
        onClick={onClick}
        className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Exporting…" : "Export PDF"}
      </button>
      {err && <span className="text-xs text-red-400">{err}</span>}
    </div>
  );
}
