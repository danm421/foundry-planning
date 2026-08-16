"use client";

import { useEffect, useRef, useState } from "react";
import DialogShell from "@/components/dialog-shell";

export interface PreviewPageDescriptor {
  pageId: string;
  options: unknown;
  scenarioOverride?: string | null;
}

export interface PreviewRequest {
  /** Dialog title + download filename stem. */
  title: string;
  scenarioId: string | null;
  pages: PreviewPageDescriptor[];
  /** Overrides the derived download filename when set. */
  filename?: string;
}

interface Props {
  /** When null the dialog is closed; the parent owns this so the array
   *  reference stays stable across the open lifetime (avoids refetch loops). */
  request: PreviewRequest | null;
  clientId: string;
  onClose: () => void;
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "preview";

export function PdfPreviewDialog({ request, clientId, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const blobRef = useRef<Blob | null>(null);

  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    setLoading(true);
    setError(null);
    setBlobUrl(null);
    blobRef.current = null;

    (async () => {
      try {
        const res = await fetch(
          `/api/clients/${clientId}/presentations/export-pdf`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              scenarioId: request.scenarioId,
              preview: true,
              pages: request.pages,
            }),
          },
        );
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `HTTP ${res.status}`);
        }
        const blob = await res.blob();
        if (cancelled) return;
        blobRef.current = blob;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [request, clientId]);

  function handleDownload() {
    const blob = blobRef.current;
    if (!blob || !request) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = request.filename ?? `${slug(request.title)}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // DialogShell renders null when open=false, but early-returning here
  // ensures the "renders nothing when request is null" test gets an empty DOM.
  if (!request) return null;

  return (
    <DialogShell
      open={true}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={request.title}
      size="lg"
      contentFill
      primaryAction={{
        label: "Download PDF",
        onClick: handleDownload,
        disabled: blobUrl === null,
      }}
      secondaryAction={{ label: "Close", onClick: onClose }}
    >
      {loading && (
        <div className="flex flex-1 min-h-0 items-center justify-center gap-3 text-sm text-ink-3">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-hair border-t-accent" />
          Rendering preview…
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="flex flex-1 min-h-0 items-center justify-center px-6 text-center text-sm text-crit"
        >
          {error}
        </div>
      )}
      {blobUrl && !loading && !error && (
        <iframe
          title={`${request.title} preview`}
          src={blobUrl}
          className="flex-1 min-h-0 w-full rounded border border-hair bg-white"
        />
      )}
    </DialogShell>
  );
}
