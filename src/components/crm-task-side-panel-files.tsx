"use client";

import { useRef, useState } from "react";

import ConfirmDeleteDialog from "./confirm-delete-dialog";
import {
  AlertCircleIcon,
  ExternalLinkIcon,
  FileTextIcon,
  TrashIcon,
} from "@/components/icons";

export interface TaskFileRow {
  id: string;
  taskId: string;
  uploadedByUserId: string;
  filename: string;
  storageProvider: string;
  storageKey: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedAt: string;
}

interface CrmTaskSidePanelFilesProps {
  taskId: string;
  initialFiles: TaskFileRow[];
}

function humanSize(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return sec <= 1 ? "just now" : `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.round(mo / 12);
  return `${yr}y ago`;
}


export function CrmTaskSidePanelFiles({
  taskId,
  initialFiles,
}: CrmTaskSidePanelFilesProps) {
  const [files, setFiles] = useState<TaskFileRow[]>(initialFiles);
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<TaskFileRow | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function upload(file: File) {
    setUploadingName(file.name);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/crm/tasks/${taskId}/files`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          typeof j.error === "string" ? j.error : `Upload failed (${res.status})`,
        );
      }
      const { file: row } = (await res.json()) as { file: TaskFileRow };
      setFiles((prev) => [row, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingName(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    await upload(f);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void upload(f);
  }

  async function doDelete(row: TaskFileRow) {
    try {
      const res = await fetch(`/api/crm/tasks/${taskId}/files/${row.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          typeof j.error === "string" ? j.error : `Delete failed (${res.status})`,
        );
      }
      setFiles((prev) => prev.filter((f) => f.id !== row.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setConfirmDelete(null);
    }
  }

  return (
    <div className="space-y-4">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={
          "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--radius)] border border-dashed px-4 py-6 text-center text-[13px] transition-colors " +
          (dragOver
            ? "border-accent bg-accent/10 text-accent"
            : "border-hair bg-card-2 text-ink-3 hover:border-hair-2 hover:text-ink-2")
        }
      >
        <span className="font-medium">Drop a file here or click to upload</span>
        <span className="text-[11px] text-ink-3">Saves to firm storage</span>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          onChange={onPick}
        />
      </div>

      {uploadingName && (
        <p className="text-[12px] text-ink-3">Uploading {uploadingName}…</p>
      )}

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

      {files.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-hair bg-card-2 px-4 py-6 text-center">
          <p className="text-[13px] text-ink-3">No files yet.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {files.map((row) => (
            <li
              key={row.id}
              className="flex items-start gap-3 rounded-[var(--radius)] border border-hair bg-card p-3"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/10 text-accent">
                <FileTextIcon width={14} height={14} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <p className="truncate text-[13px] font-semibold text-ink">
                    {row.filename}
                  </p>
                  <span className="text-[11px] tabular-nums text-ink-3">
                    {humanSize(row.sizeBytes)}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-3">
                  <span>by {row.uploadedByUserId}</span>
                  <span aria-hidden>·</span>
                  <time
                    dateTime={row.uploadedAt}
                    title={new Date(row.uploadedAt).toLocaleString()}
                  >
                    {relativeTime(row.uploadedAt)}
                  </time>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <a
                  href={`/api/crm/tasks/${taskId}/files/${row.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[11px] font-medium text-ink-2 hover:bg-card-2 hover:text-ink"
                >
                  Open
                  <ExternalLinkIcon width={12} height={12} aria-hidden="true" />
                </a>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(row)}
                  aria-label={`Delete ${row.filename}`}
                  title="Delete"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-ink-3 hover:bg-crit/15 hover:text-crit"
                >
                  <TrashIcon width={14} height={14} aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDeleteDialog
        open={confirmDelete !== null}
        title="Delete file"
        message={
          confirmDelete
            ? `Delete "${confirmDelete.filename}"? This cannot be undone.`
            : ""
        }
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (confirmDelete) await doDelete(confirmDelete);
        }}
      />
    </div>
  );
}
