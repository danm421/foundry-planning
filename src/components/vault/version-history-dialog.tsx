"use client";

import { useCallback, useEffect, useState } from "react";
import DialogShell from "@/components/dialog-shell";
import { DownloadIcon } from "@/components/icons";
import { humanSize, formatTimestamp } from "./format";

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

export default function VersionHistoryDialog({ householdId, docId, onClose }: Props) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/crm/households/${householdId}/documents/${docId}/versions`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load versions (${res.status})`);
      const json = (await res.json()) as { versions: Version[] };
      setVersions(json.versions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load versions");
    } finally {
      setLoading(false);
    }
  }, [householdId, docId]);

  useEffect(() => {
    if (docId) void load();
  }, [docId, load]);

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
