"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import DialogShell from "@/components/dialog-shell";
import { getArtifact } from "@/lib/report-artifacts/index";
import { getRegisteredCharts } from "@/lib/report-artifacts/chart-capture";
import type { Variant } from "@/lib/report-artifacts/types";
import { FormatSelector } from "./format-selector";

const pickDefaultVariant = (variants: readonly Variant[]): Variant => {
  if (variants.includes("chart+data")) return "chart+data";
  if (variants.includes("data")) return "data";
  return variants[0];
};

type Props = {
  reportId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId?: string;
  // Per-export option overrides merged into the artifact's defaultOptions before
  // the API request. The server validates the merged object via optionsSchema.
  optsOverride?: Record<string, unknown>;
};

export function ExportModal({ reportId, open, onOpenChange, clientId: clientIdProp, optsOverride }: Props) {
  const params = useParams();
  const clientId = clientIdProp ?? (params?.id as string | undefined) ?? "";
  const artifact = getArtifact(reportId);

  const initialVariant = useMemo(
    () => (artifact ? pickDefaultVariant(artifact.variants) : "data"),
    [artifact],
  );
  const [variant, setVariant] = useState<Variant>(initialVariant);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!artifact) {
    return (
      <DialogShell
        open={open}
        onOpenChange={onOpenChange}
        title="Export"
        size="sm"
      >
        <p className="text-sm text-gray-300">Unknown report: {reportId}</p>
      </DialogShell>
    );
  }

  const handleExport = async () => {
    setBusy(true);
    setError(null);
    try {
      const charts =
        variant === "chart" || variant === "chart+data"
          ? getRegisteredCharts(artifact.id)
          : [];
      const res = await fetch(`/api/clients/${clientId}/exports/pdf`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reportId: artifact.id,
          variant,
          opts: { ...(artifact.defaultOptions as Record<string, unknown>), ...(optsOverride ?? {}) },
          charts,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string; issues?: unknown } | null;
        const detail = body?.error
          ? `${body.error}${body.issues ? `: ${JSON.stringify(body.issues)}` : ""}`
          : "";
        console.error("Export failed", res.status, body);
        setError(`Export failed (${res.status})${detail ? ` — ${detail}` : ""}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const today = new Date().toISOString().slice(0, 10);
      const ct = res.headers.get("content-type") ?? "";
      const ext = ct.includes("zip") ? "zip" : ct.includes("csv") ? "csv" : "pdf";
      a.download = `${artifact.id}-${today}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={`Export: ${artifact.title}`}
      size="sm"
      primaryAction={{
        label: variant === "csv" ? "Export CSV" : "Export PDF",
        onClick: handleExport,
        disabled: busy || !clientId,
        loading: busy,
      }}
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs text-gray-400">
          Single export · <span className="opacity-60">Build PDF package (coming soon)</span>
        </p>
        <FormatSelector
          variants={artifact.variants}
          value={variant}
          onChange={setVariant}
        />
        {error && <p className="text-sm text-crit">{error}</p>}
      </div>
    </DialogShell>
  );
}
