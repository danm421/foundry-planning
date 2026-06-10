"use client";

import { useEffect, useState } from "react";
import DialogShell from "@/components/dialog-shell";
import { DownloadIcon } from "@/components/icons";

type Props = {
  householdId: string;
  docId: string | null; // null = closed
  onClose: () => void;
};

type Version = {
  id: string;
  versionNo: number;
  createdAt: string;
  sizeBytes: number | null;
};

function humanSize(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function VersionHistoryDialog({ householdId, docId, onClose }: Props) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!docId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/crm/households/${householdId}/documents/${docId}/versions`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load versions (${res.status})`);
        const json = (await res.json()) as { versions: Version[] };
        if (!cancelled) setVersions(json.versions ?? []);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load versions"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [householdId, docId]);

  if (!docId) return null;

  return (
    <DialogShell
      open={docId !== null}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title="Version history"
      size="md"
    >
      {loading ? (
        <p className="text-[13px] text-ink-3">Loading versions…</p>
      ) : error ? (
        <p className="text-[13px] text-crit">{error}</p>
      ) : versions.length === 0 ? (
        <p className="text-[13px] text-ink-3">No versions found.</p>
      ) : (
        <ul className="divide-y divide-hair overflow-hidden rounded-[var(--radius)] border border-hair">
          {versions.map((v, i) => (
            <li key={v.id} className="flex items-center justify-between gap-3 bg-card px-4 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[13.5px] font-semibold text-ink">
                  <span className="tabular">v{v.versionNo}</span>
                  {i === 0 && (
                    <span className="rounded border border-hair bg-card-2 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-3">
                      Current
                    </span>
                  )}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-ink-3">
                  <time dateTime={v.createdAt} className="tabular">{formatTimestamp(v.createdAt)}</time>
                  <span aria-hidden>·</span>
                  <span className="tabular">{humanSize(v.sizeBytes)}</span>
                </p>
              </div>
              <a
                href={`/api/crm/households/${householdId}/documents/${v.id}`}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:bg-accent/10 hover:text-accent"
              >
                <DownloadIcon width={14} height={14} aria-hidden="true" />
                Download
              </a>
            </li>
          ))}
        </ul>
      )}
    </DialogShell>
  );
}
