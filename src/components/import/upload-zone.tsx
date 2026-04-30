"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS } from "@/lib/extraction/types";
import type { DocumentType } from "@/lib/extraction/types";

export type UploadState = "queued" | "uploading" | "uploaded" | "failed";

export interface UploadingFile {
  id: string;
  file: File;
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
  deduped: boolean;
}

interface UploadZoneProps {
  clientId: string;
  importId: string;
  /** Called after each successful upload — parent typically router.refresh()es. */
  onUploaded?: (info: UploadedFileInfo) => void;
  disabled?: boolean;
}

const ACCEPTED_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".xlsx", ".xls", ".csv"];

function detectTypeFromExtension(name: string): DocumentType | "auto" {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["xlsx", "xls", "csv"].includes(ext)) return "excel_import";
  return "auto";
}

export default function UploadZone({
  clientId,
  importId,
  onUploaded,
  disabled,
}: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<UploadingFile[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Pin the latest onUploaded callback in a ref so the upload XHR closure
  // can read it without re-running startUpload's identity (which would
  // otherwise restart in-flight uploads if the parent re-renders).
  const onUploadedRef = useRef(onUploaded);
  useEffect(() => {
    onUploadedRef.current = onUploaded;
  }, [onUploaded]);

  const updateFile = useCallback(
    (id: string, patch: Partial<UploadingFile>) => {
      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    },
    [],
  );

  const startUpload = useCallback(
    (target: UploadingFile) => {
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
            updateFile(target.id, {
              state: "uploaded",
              progress: 100,
              serverFileId: body.file.id,
              deduped: body.deduped,
            });
            onUploadedRef.current?.({
              serverFileId: body.file.id,
              deduped: body.deduped,
            });
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
    [clientId, importId, updateFile],
  );

  const addFiles = useCallback(
    (fileList: FileList | File[]) => {
      const newFiles: UploadingFile[] = Array.from(fileList).map((file) => ({
        id: crypto.randomUUID(),
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

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const updateFileType = useCallback(
    (id: string, type: DocumentType | "auto") => {
      // Picker is only editable while the file is still queued — once the
      // POST is in flight, the server has already accepted the type.
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id && f.state === "queued" ? { ...f, documentType: type } : f,
        ),
      );
    },
    [],
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
            ? "cursor-not-allowed border-gray-700 bg-gray-900/50 opacity-50"
            : isDragging
              ? "border-accent bg-accent/10"
              : "border-gray-600 bg-gray-900/30 hover:border-gray-500 hover:bg-gray-900/50"
        }`}
      >
        <UploadIcon />
        <p className="mt-3 text-sm text-gray-300">
          Drag & drop files here, or <span className="text-accent underline">browse</span>
        </p>
        <p className="mt-1 text-xs text-gray-400">
          PDF, Excel, CSV, PNG, JPG — up to 20MB each
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
  const pickerDisabled = disabled || file.state !== "queued";

  return (
    <div className="rounded-md border border-gray-700 bg-gray-900 px-3 py-2">
      <div className="flex items-center gap-3">
        <FileIcon />
        <span className="min-w-0 flex-1 truncate text-sm text-gray-200">
          {file.file.name}
        </span>
        <select
          value={file.documentType}
          onChange={(e) => onTypeChange(e.target.value as DocumentType | "auto")}
          disabled={pickerDisabled}
          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-gray-300 focus:border-accent focus:outline-none disabled:opacity-60"
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
          className="text-gray-400 hover:text-red-400 disabled:opacity-50"
          title="Remove file"
        >
          <XIcon />
        </button>
      </div>

      {file.state === "uploading" && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded bg-gray-800">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${file.progress}%` }}
          />
        </div>
      )}
      {file.state === "failed" && file.errorMessage && (
        <p className="mt-1 text-xs text-red-400">{file.errorMessage}</p>
      )}
    </div>
  );
}

function StateBadge({ file }: { file: UploadingFile }) {
  switch (file.state) {
    case "queued":
      return (
        <span className="text-xs text-gray-400">Queued</span>
      );
    case "uploading":
      return (
        <span className="text-xs text-accent">Uploading… {file.progress}%</span>
      );
    case "uploaded":
      return (
        <span className="text-xs text-good">
          ✓ {file.deduped ? "Deduped" : "Uploaded"}
        </span>
      );
    case "failed":
      return <span className="text-xs text-red-400">Failed</span>;
  }
}

function UploadIcon() {
  return (
    <svg className="h-10 w-10 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg className="h-4 w-4 flex-shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
