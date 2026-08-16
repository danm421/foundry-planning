"use client";

import { useEffect, useRef, useState } from "react";
import DialogShell from "@/components/dialog-shell";
import type { UnreviewedStoryPage } from "@/lib/presentations/story/export-gate";

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
  /**
   * The soft export gate's count, per Plan Story page — the caller's to
   * supply, not this dialog's to fetch. `export-pdf` (below) streams a PDF
   * with nowhere to carry it, so there is no "render response" this component
   * could read it from; a caller that already knows the count (the `runs`
   * route's async/202 JSON body carries one) hands it down here instead.
   * Undefined or empty renders no warning.
   */
  storyReview?: UnreviewedStoryPage[];
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

  // The soft export gate's warning. Every entry with something unreviewed —
  // there can be two, a brief up front and a full story later in the same
  // deck, and each warns on its own line (see `PreviewRequest.storyReview`).
  const unreviewedPages = (request.storyReview ?? []).filter((p) => p.unreviewed > 0);

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
      {/* Does not block: the primary action above stays enabled either way —
          this is what makes the audit row the runs route files (Task 16's
          export-gate.ts) an honest one rather than a silent one. Its "link"
          just closes the dialog: the review panel lives inline in this page's
          own options control, not at a URL this modal could send anyone to. */}
      {unreviewedPages.length > 0 && (
        <div className="mb-3 flex flex-col gap-1.5">
          {unreviewedPages.map((p) => (
            <p key={`${p.pageId}-${p.documentRole}`} className="text-xs text-warn">
              {`${p.unreviewed} of ${p.total} Plan Story chapters haven't been reviewed yet.`}{" "}
              <button type="button" className="underline hover:text-ink" onClick={onClose}>
                Review before you send this
              </button>
            </p>
          ))}
        </div>
      )}
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
