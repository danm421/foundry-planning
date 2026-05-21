"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircleIcon,
  DownloadIcon,
  FileTextIcon,
  TrashIcon,
} from "@/components/icons";

export type CrmDocumentRow = {
  id: string;
  householdId: string;
  filename: string;
  storageProvider: string;
  storageKey: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedBy: string | null;
  createdAt: string;
};

interface Props {
  householdId: string;
}

const MAX_SIZE_BYTES = 10 * 1024 * 1024;

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

function actorDisplay(actorUserId: string | null): string {
  if (!actorUserId) return "—";
  if (actorUserId.length > 12) return actorUserId.slice(0, 10) + "…";
  return actorUserId;
}

export function CrmDocumentList({ householdId }: Props) {
  const [rows, setRows] = useState<CrmDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/crm/households/${householdId}/documents`, {
        signal: ctrl.signal,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Failed to load documents (${res.status})`);
      const json = (await res.json()) as { documents: CrmDocumentRow[] };
      setRows(json.documents ?? []);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    void reload();
    return () => {
      abortRef.current?.abort();
    };
  }, [reload]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_SIZE_BYTES) {
      setError(
        `${file.name} is too large. Maximum size is 10MB.`,
      );
      // Reset the file input so the user can choose another file.
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/crm/households/${householdId}/documents`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: unknown;
        };
        const msg =
          typeof json.error === "string"
            ? json.error
            : `Upload failed (${res.status})`;
        throw new Error(msg);
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function onDelete(doc: CrmDocumentRow) {
    if (!window.confirm(`Delete document "${doc.filename}"? This cannot be undone.`)) {
      return;
    }
    setBusyId(doc.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/crm/households/${householdId}/documents/${doc.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: unknown;
        };
        const msg =
          typeof json.error === "string"
            ? json.error
            : `Delete failed (${res.status})`;
        throw new Error(msg);
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-3">
          Documents ({rows.length})
        </h2>
        <label
          className={`inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-on shadow-[0_1px_0_rgba(0,0,0,0.25)] transition-colors hover:bg-accent-deep ${
            uploading ? "opacity-60" : ""
          }`}
        >
          {uploading ? "Uploading…" : "Upload document"}
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            disabled={uploading}
            onChange={onUpload}
          />
        </label>
      </div>

      <p className="text-[12px] text-ink-3">
        Maximum file size 10MB. Files are stored privately and only accessible
        to your firm.
      </p>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-crit/30 bg-crit/10 px-3 py-2 text-[13px] text-crit"
        >
          <AlertCircleIcon
            width={16}
            height={16}
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <span>{error}</span>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="text-[13px] text-ink-3">Loading documents…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-hair bg-card-2 px-6 py-10 text-center">
          <p className="text-[13px] text-ink-3">No documents yet.</p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((doc) => (
            <li
              key={doc.id}
              className="flex items-start gap-3 rounded-[var(--radius)] border border-hair bg-card p-3.5 transition-colors hover:border-hair-2"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/10 text-accent">
                <FileTextIcon width={14} height={14} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <p className="truncate text-[13.5px] font-semibold text-ink">
                    {doc.filename}
                  </p>
                  <span className="text-[11.5px] tabular-nums text-ink-3">
                    {humanSize(doc.sizeBytes)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-3">
                  <time
                    dateTime={doc.createdAt}
                    title={new Date(doc.createdAt).toLocaleString()}
                    className="tabular-nums"
                  >
                    {formatTimestamp(doc.createdAt)}
                  </time>
                  <span aria-hidden>·</span>
                  <span>by {actorDisplay(doc.uploadedBy)}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <a
                  href={`/api/crm/households/${householdId}/documents/${doc.id}`}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-ink-3 transition-colors hover:bg-accent/10 hover:text-accent"
                  aria-label={`Download ${doc.filename}`}
                  title="Download"
                >
                  <DownloadIcon width={14} height={14} aria-hidden="true" />
                </a>
                <button
                  type="button"
                  onClick={() => onDelete(doc)}
                  disabled={busyId === doc.id}
                  aria-label={`Delete ${doc.filename}`}
                  title="Delete"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-ink-3 transition-colors hover:bg-crit/15 hover:text-crit disabled:opacity-50"
                >
                  <TrashIcon width={14} height={14} aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
