"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS } from "@/lib/extraction/types";
import type { DocumentType } from "@/lib/extraction/types";
import type { ClientDocumentSource, ClientDocumentView } from "@/lib/imports/client-documents";
import { formatBytes } from "@/components/portal/documents/vault-format";

export type UploadState = "queued" | "uploading" | "uploaded" | "failed";

export interface UploadingFile {
  id: string;
  /** Display name — present for both in-session uploads and seeded server files. */
  name: string;
  /** The browser File for an in-session upload. Absent for rows seeded from
   *  already-uploaded server files (those never re-upload). */
  file?: File;
  /** Set instead of `file` when the row is a file from the client's vault —
   *  the server copies it in. */
  clientDocumentId?: string;
  documentType: DocumentType | "auto";
  state: UploadState;
  /** 0–100. Browsers don't expose download progress for fetch, so XHR is used. */
  progress: number;
  errorMessage?: string;
  serverFileId?: string;
  deduped?: boolean;
}

export interface UploadedFileInfo {
  serverFileId: string;
  /** Display name, so a caller that reports per-file problems can name the
   *  file the advisor actually recognises rather than its id (M11). */
  name: string;
  deduped: boolean;
}

/** A file already persisted on the server, used to seed the list on mount. */
export interface InitialUploadedFile {
  serverFileId: string;
  name: string;
  documentType: string;
}

interface UploadZoneProps {
  clientId: string;
  importId: string;
  /** Files already uploaded for this import — seeded once as "uploaded" rows so
   *  the list survives reloads and revisits. */
  initialFiles?: InitialUploadedFile[];
  /** Called after each successful upload — parent typically router.refresh()es. */
  onUploaded?: (info: UploadedFileInfo) => void;
  /** Called after a persisted file is removed (its server row is deleted), with its id. */
  onRemoved?: (serverFileId: string) => void;
  disabled?: boolean;
  /** Files in the client's vault, offered for adding without a download and
   *  re-upload. */
  clientDocuments?: ClientDocumentView[];
}

// No legacy .xls: the server only reads the .xlsx format, so it would always fail.
const ACCEPTED_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".docx", ".xlsx", ".csv"];

function detectTypeFromExtension(name: string): DocumentType | "auto" {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["xlsx", "csv"].includes(ext)) return "excel_import";
  return "auto";
}

/** Coerce a stored documentType string into a value the picker can render. */
function normalizeDocType(type: string): DocumentType | "auto" {
  if (type === "auto") return "auto";
  return (DOCUMENT_TYPES as readonly string[]).includes(type)
    ? (type as DocumentType)
    : "auto";
}

export default function UploadZone({
  clientId,
  importId,
  initialFiles,
  onUploaded,
  onRemoved,
  disabled,
  clientDocuments,
}: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  // Seed once from the files already persisted for this import so the list
  // survives reloads/revisits. In-session uploads append to this state; the
  // seed never re-runs, so a parent router.refresh() can't double-list a file.
  const [files, setFiles] = useState<UploadingFile[]>(() =>
    (initialFiles ?? []).map((f) => ({
      id: f.serverFileId,
      name: f.name,
      documentType: normalizeDocType(f.documentType),
      state: "uploaded" as const,
      progress: 100,
      serverFileId: f.serverFileId,
    })),
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // Pin the latest callbacks in refs so closures (upload XHR, file delete) can
  // read them without re-running startUpload's identity (which would otherwise
  // restart in-flight uploads if the parent re-renders).
  const onUploadedRef = useRef(onUploaded);
  const onRemovedRef = useRef(onRemoved);
  useEffect(() => {
    onUploadedRef.current = onUploaded;
    onRemovedRef.current = onRemoved;
  }, [onUploaded, onRemoved]);

  const updateFile = useCallback(
    (id: string, patch: Partial<UploadingFile>) => {
      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    },
    [],
  );

  const markUploaded = useCallback(
    (target: UploadingFile, body: { file: { id: string }; deduped: boolean }) => {
      updateFile(target.id, {
        state: "uploaded",
        progress: 100,
        serverFileId: body.file.id,
        deduped: body.deduped,
      });
      onUploadedRef.current?.({
        serverFileId: body.file.id,
        name: target.name,
        deduped: body.deduped,
      });
    },
    [updateFile],
  );

  const startUpload = useCallback(
    (target: UploadingFile) => {
      if (target.clientDocumentId) {
        updateFile(target.id, { state: "uploading", progress: 0 });
        fetch(`/api/clients/${clientId}/imports/${importId}/client-documents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentId: target.clientDocumentId }),
        })
          .then(async (res) => {
            const body = (await res.json().catch(() => ({}))) as {
              file?: { id: string };
              deduped?: boolean;
              error?: string;
            };
            if (res.ok && body.file) {
              markUploaded(target, { file: body.file, deduped: Boolean(body.deduped) });
            } else {
              updateFile(target.id, {
                state: "failed",
                errorMessage: body.error ?? `Couldn't add this document (${res.status})`,
              });
            }
          })
          .catch(() => updateFile(target.id, { state: "failed", errorMessage: "Network error" }));
        return;
      }
      // Only in-session rows carry a File; seeded server rows never upload.
      if (!target.file) return;
      const xhr = new XMLHttpRequest();
      const url = `/api/clients/${clientId}/imports/${importId}/files`;
      xhr.open("POST", url);
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        updateFile(target.id, {
          progress: Math.round((e.loaded / e.total) * 100),
        });
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const body = JSON.parse(xhr.responseText) as {
              file: { id: string };
              deduped: boolean;
            };
            markUploaded(target, body);
          } catch {
            updateFile(target.id, {
              state: "failed",
              errorMessage: "Bad response from server",
            });
          }
          return;
        }
        let message = `Upload failed (${xhr.status})`;
        try {
          const body = JSON.parse(xhr.responseText) as { error?: string };
          if (body.error) message = body.error;
        } catch {
          // keep the generic status-code message
        }
        updateFile(target.id, { state: "failed", errorMessage: message });
      };
      xhr.onerror = () => {
        updateFile(target.id, {
          state: "failed",
          errorMessage: "Network error",
        });
      };

      const fd = new FormData();
      fd.append("file", target.file);
      fd.append("documentType", target.documentType);
      updateFile(target.id, { state: "uploading", progress: 0 });
      xhr.send(fd);
    },
    [clientId, importId, updateFile, markUploaded],
  );

  const addFiles = useCallback(
    (fileList: FileList | File[]) => {
      const newFiles: UploadingFile[] = Array.from(fileList).map((file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        file,
        documentType: detectTypeFromExtension(file.name),
        state: "queued",
        progress: 0,
      }));
      if (newFiles.length === 0) return;
      setFiles((prev) => [...prev, ...newFiles]);
      // Kick off uploads on the next tick so the queued state renders first.
      for (const f of newFiles) {
        setTimeout(() => startUpload(f), 0);
      }
    },
    [startUpload],
  );

  const addClientDocument = useCallback(
    (doc: ClientDocumentView) => {
      const row: UploadingFile = {
        id: crypto.randomUUID(),
        name: doc.filename,
        clientDocumentId: doc.id,
        documentType: "auto",
        state: "queued",
        progress: 0,
      };
      setFiles((prev) => [...prev, row]);
      setTimeout(() => startUpload(row), 0);
    },
    [startUpload],
  );

  // A vault file leaves the list once it's in the import (matched by name —
  // the copy keeps its filename), and comes back if it's removed.
  const listedNames = new Set(files.map((f) => f.name));
  const offeredDocuments = (clientDocuments ?? []).filter((d) => !listedNames.has(d.filename));

  const retry = useCallback(
    (id: string) => {
      const target = files.find((f) => f.id === id);
      if (!target) return;
      const refreshed: UploadingFile = {
        ...target,
        state: "queued",
        progress: 0,
        errorMessage: undefined,
      };
      updateFile(id, { state: "queued", progress: 0, errorMessage: undefined });
      setTimeout(() => startUpload(refreshed), 0);
    },
    [files, startUpload, updateFile],
  );

  const removeFile = useCallback(
    (id: string) => {
      const target = files.find((f) => f.id === id);
      setFiles((prev) => prev.filter((f) => f.id !== id));
      // A persisted file leaves a server row behind; delete it so it doesn't
      // reappear on reload (and stays out of the next extraction run).
      if (target?.serverFileId) {
        const serverFileId = target.serverFileId;
        fetch(
          `/api/clients/${clientId}/imports/${importId}/files/${serverFileId}`,
          { method: "DELETE" },
        )
          .then(() => onRemovedRef.current?.(serverFileId))
          .catch((err) => console.error("Failed to delete file:", err));
      }
    },
    [files, clientId, importId],
  );

  const updateFileType = useCallback(
    (id: string, type: DocumentType | "auto") => {
      // Optimistic local update for both queued and uploaded files. For
      // uploaded files we also PATCH the server row so the stored type
      // is what the extract route reads.
      let target: UploadingFile | undefined;
      setFiles((prev) =>
        prev.map((f) => {
          if (f.id !== id) return f;
          if (f.state !== "queued" && f.state !== "uploaded") return f;
          target = f;
          return { ...f, documentType: type };
        }),
      );
      if (target && target.state === "uploaded" && target.serverFileId) {
        const url = `/api/clients/${clientId}/imports/${importId}/files/${target.serverFileId}`;
        fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentType: type }),
        }).catch((err) => {
          console.error("Failed to update document type:", err);
        });
      }
    },
    [clientId, importId],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!disabled) setIsDragging(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (!disabled && e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [disabled, addFiles],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files);
        e.target.value = "";
      }
    },
    [addFiles],
  );

  return (
    <div className="space-y-4">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
          disabled
            ? "cursor-not-allowed border-hair-3 bg-card-2/50 opacity-50"
            : isDragging
              ? "border-accent bg-accent/10"
              : "border-hair-3 bg-card-2/30 hover:bg-card-2/50"
        }`}
      >
        <UploadIcon />
        <p className="mt-3 text-sm text-ink-3">
          Drag & drop files here, or <span className="text-accent underline">browse</span>
        </p>
        <p className="mt-1 text-xs text-ink-4">
          PDF, Word, Excel, CSV, PNG, JPG — up to 20MB each
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS.join(",")}
          onChange={handleInputChange}
          className="hidden"
          disabled={disabled}
        />
      </div>

      {offeredDocuments.length > 0 && (
        <ClientDocumentsList
          documents={offeredDocuments}
          onAdd={addClientDocument}
          disabled={disabled}
        />
      )}

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((f) => (
            <UploadRow
              key={f.id}
              file={f}
              onRetry={() => retry(f.id)}
              onRemove={() => removeFile(f.id)}
              onTypeChange={(t) => updateFileType(f.id, t)}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface UploadRowProps {
  file: UploadingFile;
  onRetry: () => void;
  onRemove: () => void;
  onTypeChange: (t: DocumentType | "auto") => void;
  disabled?: boolean;
}

function UploadRow({ file, onRetry, onRemove, onTypeChange, disabled }: UploadRowProps) {
  const pickerDisabled =
    disabled || (file.state !== "queued" && file.state !== "uploaded");

  return (
    <div className="rounded-md border border-hair bg-card px-3 py-2">
      {/* In a narrow panel the controls wrap under the name rather than squeezing it to nothing. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <FileIcon />
        <span className="min-w-[8rem] flex-1 truncate text-sm text-ink-2">
          {file.name}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <select
            value={file.documentType}
            onChange={(e) => onTypeChange(e.target.value as DocumentType | "auto")}
            disabled={pickerDisabled}
            className="rounded border border-hair-2 bg-paper px-2 py-1 text-xs text-ink-3 focus:border-accent focus:outline-none disabled:opacity-60"
          >
            <option value="auto">Auto-detect</option>
            {DOCUMENT_TYPES.map((dt) => (
              <option key={dt} value={dt}>
                {DOCUMENT_TYPE_LABELS[dt]}
              </option>
            ))}
          </select>
          <StateBadge file={file} />
          {file.state === "failed" && (
            <button
              onClick={onRetry}
              disabled={disabled}
              className="text-xs text-accent underline hover:text-accent-ink disabled:opacity-50"
            >
              Retry
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            disabled={disabled}
            className="text-ink-3 hover:text-ink disabled:opacity-50"
            title="Remove file"
          >
            <XIcon />
          </button>
        </div>
      </div>

      {file.state === "uploading" && file.file && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded bg-card-2">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${file.progress}%` }}
          />
        </div>
      )}
      {file.state === "failed" && file.errorMessage && (
        <p className="mt-1 text-xs text-crit">{file.errorMessage}</p>
      )}
    </div>
  );
}

function StateBadge({ file }: { file: UploadingFile }) {
  switch (file.state) {
    case "queued":
      return (
        <span className="text-xs text-ink-4">Queued</span>
      );
    case "uploading":
      // A client upload is copied server side, so there is no progress to show.
      return file.file ? (
        <span className="text-xs text-accent">Uploading… {file.progress}%</span>
      ) : (
        <span className="text-xs text-accent">Adding…</span>
      );
    case "uploaded":
      return (
        <span className="text-xs text-good">
          ✓ {file.deduped ? "Deduped" : "Uploaded"}
        </span>
      );
    case "failed":
      return <span className="text-xs text-crit">Failed</span>;
  }
}

const SOURCE_LABELS: Record<ClientDocumentSource, string> = {
  data_collection: "Data Collection",
  portal: "Client portal",
  firm: "Your firm",
};

// A well-kept vault would bury the import's own file list, so only the newest
// few show until the advisor asks for the rest.
const CLIENT_DOCUMENTS_SHOWN = 5;

function ClientDocumentsList({
  documents,
  onAdd,
  disabled,
}: {
  documents: ClientDocumentView[];
  onAdd: (doc: ClientDocumentView) => void;
  disabled?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? documents : documents.slice(0, CLIENT_DOCUMENTS_SHOWN);
  const hidden = documents.length - shown.length;
  return (
    <section aria-label="The client's documents" className="space-y-2">
      <p className="text-xs text-ink-3">From the client&apos;s documents</p>
      <ul className="space-y-2">
        {shown.map((doc) => {
          const details = [SOURCE_LABELS[doc.source], doc.typeLabel]
            .filter(Boolean)
            .join(" · ");
          return (
            <li
              key={doc.id}
              className="flex items-center gap-3 rounded-md border border-hair bg-card px-3 py-2"
            >
              <FileIcon />
              <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{doc.filename}</span>
              <span className="text-xs text-ink-3">{details}</span>
              {doc.sizeBytes ? (
                <span className="tabular text-xs text-ink-4">{formatBytes(doc.sizeBytes)}</span>
              ) : null}
              <button
                type="button"
                onClick={() => onAdd(doc)}
                disabled={disabled}
                aria-label={`Add ${doc.filename}`}
                className="rounded border border-hair-2 px-2 py-1 text-xs font-medium text-ink-2 hover:border-accent hover:text-accent-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add
              </button>
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="text-xs text-ink-3 underline-offset-2 hover:text-ink-2 hover:underline"
        >
          Show <span className="tabular">{hidden}</span> more
        </button>
      )}
    </section>
  );
}

function UploadIcon() {
  return (
    <svg className="h-10 w-10 text-ink-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg className="h-4 w-4 flex-shrink-0 text-ink-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
