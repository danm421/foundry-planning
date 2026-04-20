"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS } from "@/lib/extraction/types";
import type { DocumentType } from "@/lib/extraction/types";

export interface QueuedFile {
  id: string;
  file: File;
  detectedType: DocumentType | "auto";
}

interface UploadZoneProps {
  onFilesQueued: (files: QueuedFile[]) => void;
  disabled?: boolean;
}

const ACCEPTED_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".xlsx", ".xls", ".csv"];

function detectTypeFromExtension(name: string): DocumentType | "auto" {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["xlsx", "xls", "csv"].includes(ext)) return "excel_import";
  return "auto";
}

export default function UploadZone({ onFilesQueued, disabled }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync parent whenever files change — avoids setState-during-render
  useEffect(() => {
    onFilesQueued(files);
  }, [files, onFilesQueued]);

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const newFiles: QueuedFile[] = Array.from(fileList).map((file) => ({
      id: crypto.randomUUID(),
      file,
      detectedType: detectTypeFromExtension(file.name),
    }));
    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const updateFileType = useCallback((id: string, type: DocumentType | "auto") => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, detectedType: type } : f)));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  }, [disabled]);

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
    [disabled, addFiles]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files);
        e.target.value = "";
      }
    },
    [addFiles]
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
              ? "border-blue-400 bg-blue-900/20"
              : "border-gray-600 bg-gray-900/30 hover:border-gray-500 hover:bg-gray-900/50"
        }`}
      >
        <UploadIcon />
        <p className="mt-3 text-sm text-gray-300">
          Drag & drop files here, or <span className="text-blue-400 underline">browse</span>
        </p>
        <p className="mt-1 text-xs text-gray-500">
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
          {files.map((qf) => (
            <div
              key={qf.id}
              className="flex items-center gap-3 rounded-md border border-gray-700 bg-gray-900 px-3 py-2"
            >
              <FileIcon />
              <span className="min-w-0 flex-1 truncate text-sm text-gray-200">
                {qf.file.name}
              </span>
              <select
                value={qf.detectedType}
                onChange={(e) => updateFileType(qf.id, e.target.value as DocumentType | "auto")}
                disabled={disabled}
                className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-gray-300 focus:border-blue-500 focus:outline-none"
              >
                <option value="auto">Auto-detect</option>
                {DOCUMENT_TYPES.map((dt) => (
                  <option key={dt} value={dt}>
                    {DOCUMENT_TYPE_LABELS[dt]}
                  </option>
                ))}
              </select>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile(qf.id);
                }}
                disabled={disabled}
                className="text-gray-500 hover:text-red-400 disabled:opacity-50"
                title="Remove file"
              >
                <XIcon />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UploadIcon() {
  return (
    <svg className="h-10 w-10 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg className="h-4 w-4 flex-shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
