"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_DOCUMENT_SIZE_BYTES } from "@/lib/crm/document-constants";
import {
  INTAKE_DOC_TYPES,
  INTAKE_DOC_TYPE_LABELS,
  intakeDocTypeLabel,
  type IntakeDocType,
  type IntakeDocumentView,
} from "@/lib/intake/document-types";
import { formatBytes } from "@/components/portal/documents/vault-format";
import { labelCls, selectCls } from "./steps/card-list";

// ─── Public interface ────────────────────────────────────────────────────────

/**
 * Everything a step needs to offer uploads, in one optional prop.
 *
 * `undefined` is the whole contract for "no uploads here": the portal wizard
 * and the advisor's preview have no public token, so they pass nothing and no
 * upload affordance renders anywhere in the wizard.
 */
export interface IntakeUploadContext {
  token: string;
  /** Every document on the form; each zone filters to the types it owns. */
  documents: IntakeDocumentView[];
  /** Refetch the list — the wizard's owner holds it. */
  onChanged: () => void;
}

export interface IntakeUploadZoneProps {
  /** The intake form's public token — the only credential these routes take. */
  token: string;
  /** The type uploads are filed under. With `allowTypeChoice` it seeds the picker. */
  docType: IntakeDocType;
  /** The Documents step lets the client say what each file is; contextual
   *  zones (Accounts, Income, Property) already know. */
  allowTypeChoice?: boolean;
  /** Already-uploaded files, owned by the caller and refetched on `onChanged`. */
  documents: IntakeDocumentView[];
  /** Called after every upload and every removal so the caller can refetch. */
  onChanged: () => void;
  /** Primary line inside the drop zone, e.g. "Add a statement". */
  label: string;
  /** Second line; defaults to the accepted formats and the per-file size cap. */
  hint?: string;
}

// ─── Upload constraints ──────────────────────────────────────────────────────

const MAX_MB = Math.floor(MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024));

/** Mirrors the message `uploadIntakeDocument` throws for the same condition, so
 *  a file rejected here reads identically to one rejected by the server. */
const TOO_LARGE_MESSAGE = `File too large. Maximum size is ${MAX_MB}MB.`;

/** A hint to the file picker only — the server re-derives the real type from
 *  the magic bytes (`validateDocumentUpload`), so this list can never widen
 *  what is actually accepted. */
const ACCEPTED_EXTENSIONS = [
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".csv",
  ".txt",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".heic",
];

const DEFAULT_HINT = `PDF, Word, Excel, CSV, or a photo — up to ${MAX_MB}MB each.`;

// ─── In-flight uploads ───────────────────────────────────────────────────────
//
// The uploaded list is the caller's `documents` prop, refetched after every
// change. This local state covers only what that list can't yet show: a file
// mid-flight, and one that failed.

type UploadState = "uploading" | "uploaded" | "failed";

interface PendingUpload {
  /** Local row key; the server id (once known) is `serverId`. */
  id: string;
  name: string;
  file: File;
  docType: IntakeDocType;
  state: UploadState;
  /** 0–100. Browsers report upload progress on XHR only, never on fetch. */
  progress: number;
  errorMessage?: string;
  serverId?: string;
}

/**
 * A finished upload stays on screen until the caller's refetched `documents`
 * carries it, so the file never blinks out of the list between the 201 and the
 * refetch landing. Without a server id there is nothing to match on, so it
 * yields to the refetch immediately rather than risk listing twice.
 */
function stillPending(row: PendingUpload, documents: IntakeDocumentView[]): boolean {
  if (row.state !== "uploaded") return true;
  return row.serverId != null && !documents.some((d) => d.id === row.serverId);
}

/** The server writes client-readable messages; prefer them over a status code. */
function errorFromResponse(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    /* fall through to the generic message */
  }
  return `Upload failed (${status}). Please try again.`;
}

// ─── IntakeUploadZone ────────────────────────────────────────────────────────

export function IntakeUploadZone({
  token,
  docType,
  allowTypeChoice = false,
  documents,
  onChanged,
  label,
  hint,
}: IntakeUploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [selectedType, setSelectedType] = useState<IntakeDocType>(docType);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextRowId = useRef(0);

  // Pinned so an XHR handler created at upload time still calls the caller's
  // current callback, without `startUpload` changing identity mid-flight.
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  const patchRow = useCallback((id: string, patch: Partial<PendingUpload>) => {
    setPending((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const startUpload = useCallback(
    (row: PendingUpload) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/intake/${token}/documents`);
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        patchRow(row.id, { progress: Math.round((e.loaded / e.total) * 100) });
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          let serverId: string | undefined;
          try {
            serverId = (JSON.parse(xhr.responseText) as { document?: { id?: string } })
              .document?.id;
          } catch {
            /* the row yields to the refetch instead — see stillPending */
          }
          patchRow(row.id, { state: "uploaded", progress: 100, serverId });
          onChangedRef.current();
          return;
        }
        patchRow(row.id, {
          state: "failed",
          errorMessage: errorFromResponse(xhr.status, xhr.responseText),
        });
      };
      xhr.onerror = () => {
        patchRow(row.id, {
          state: "failed",
          errorMessage: "Couldn't reach the server. Check your connection and try again.",
        });
      };

      const form = new FormData();
      form.append("file", row.file);
      form.append("docType", row.docType);
      xhr.send(form);
    },
    [token, patchRow],
  );

  const addFiles = useCallback(
    (fileList: FileList | File[]) => {
      const rows = Array.from(fileList).map((file) => {
        nextRowId.current += 1;
        // Oversized files never leave the device: the server would reject them
        // after the whole body was uploaded, which on a phone is a long wait
        // for a no.
        const tooLarge = file.size > MAX_DOCUMENT_SIZE_BYTES;
        return {
          id: `u${nextRowId.current}`,
          name: file.name,
          file,
          docType: allowTypeChoice ? selectedType : docType,
          state: tooLarge ? ("failed" as const) : ("uploading" as const),
          progress: 0,
          errorMessage: tooLarge ? TOO_LARGE_MESSAGE : undefined,
        };
      });
      if (rows.length === 0) return;
      setPending((prev) => [...prev, ...rows]);
      for (const row of rows) {
        if (row.state === "uploading") startUpload(row);
      }
    },
    [allowTypeChoice, selectedType, docType, startUpload],
  );

  const retry = useCallback(
    (id: string) => {
      const row = pending.find((r) => r.id === id);
      if (!row) return;
      // One statement of the retry transition, applied to both the row that
      // renders and the row that uploads — two literals could drift apart.
      const refreshed: PendingUpload = {
        ...row,
        state: "uploading",
        progress: 0,
        errorMessage: undefined,
      };
      patchRow(id, refreshed);
      startUpload(refreshed);
    },
    [pending, patchRow, startUpload],
  );

  const dismiss = useCallback((id: string) => {
    setPending((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const removeDocument = useCallback(
    async (id: string) => {
      setRemovingId(id);
      setRemoveError(null);
      try {
        const res = await fetch(`/api/intake/${token}/documents/${id}`, {
          method: "DELETE",
        });
        // A 404 means it is already gone — refetching is still the right
        // response, since the list on screen is the thing that's stale.
        if (!res.ok && res.status !== 404) {
          setRemoveError("Couldn't remove that file. Please try again.");
          return;
        }
        onChangedRef.current();
      } catch {
        setRemoveError("Couldn't reach the server. Check your connection and try again.");
      } finally {
        setRemovingId(null);
      }
    },
    [token],
  );

  function openPicker() {
    inputRef.current?.click();
  }

  const visiblePending = pending.filter((row) => stillPending(row, documents));
  const typePickerId = `intake-doctype-${docType}`;

  return (
    <div className="space-y-3">
      {allowTypeChoice && (
        <div>
          <label htmlFor={typePickerId} className={labelCls}>
            What kind of document is this?
          </label>
          <select
            id={typePickerId}
            className={selectCls}
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value as IntakeDocType)}
          >
            {INTAKE_DOC_TYPES.map((t) => (
              <option key={t} value={t}>
                {INTAKE_DOC_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      )}

      <button
        type="button"
        onClick={openPicker}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setIsDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
        }}
        className={`w-full rounded-[var(--radius-sm)] border border-dashed px-4 py-8 text-center transition-colors ${
          isDragging ? "border-accent bg-accent-wash" : "border-hair-2 hover:border-accent"
        }`}
      >
        {/* Spans, not paragraphs: a <button>'s content model is phrasing only. */}
        <UploadGlyph />
        <span className="mt-2 block text-[14px] text-ink">{label}</span>
        <span className="mt-1 block text-[13px] text-ink-3">
          Drag and drop, or <span className="text-accent">browse</span>
        </span>
        <span className="mt-1 block text-[12px] text-ink-4">{hint ?? DEFAULT_HINT}</span>
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_EXTENSIONS.join(",")}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) addFiles(e.target.files);
          e.target.value = "";
        }}
        className="hidden"
        aria-label={label}
      />

      {(documents.length > 0 || visiblePending.length > 0) && (
        <ul className="space-y-2">
          {documents.map((doc) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              removing={removingId === doc.id}
              onRemove={() => void removeDocument(doc.id)}
            />
          ))}
          {visiblePending.map((row) => (
            <PendingRow
              key={row.id}
              row={row}
              onRetry={() => retry(row.id)}
              onDismiss={() => dismiss(row.id)}
            />
          ))}
        </ul>
      )}

      {removeError && (
        <p role="alert" className="text-[12px] text-crit">
          {removeError}
        </p>
      )}
    </div>
  );
}

// ─── ContextualUploadZone ────────────────────────────────────────────────────

/**
 * The zone the Accounts, Income and Property steps hang below their card list:
 * one fixed type, and a list filtered to that type so a client on the Income
 * step sees their pay stubs and not their will. Renders nothing at all where
 * uploads aren't offered, which is what keeps the portal wizard unchanged.
 */
export function ContextualUploadZone({
  uploads,
  docType,
  label,
}: {
  uploads: IntakeUploadContext | undefined;
  docType: IntakeDocType;
  label: string;
}) {
  if (!uploads) return null;
  return (
    <IntakeUploadZone
      token={uploads.token}
      docType={docType}
      documents={uploads.documents.filter((d) => d.docType === docType)}
      onChanged={uploads.onChanged}
      label={label}
    />
  );
}

// ─── Rows ────────────────────────────────────────────────────────────────────
//
// A row shows a name, a size and a type. There is deliberately no link, no
// thumbnail and no download — once the bytes are in the advisor's vault the
// client can see that a file arrived, and nothing more.

function DocumentRow({
  doc,
  removing,
  onRemove,
}: {
  doc: IntakeDocumentView;
  removing: boolean;
  onRemove: () => void;
}) {
  const type = intakeDocTypeLabel(doc.docType);
  return (
    <li className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-hair bg-card px-3 py-2.5">
      <FileGlyph />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] text-ink">{doc.filename}</p>
        <p className="text-[12px] text-ink-3">
          <span className="tabular">{formatBytes(doc.sizeBytes)}</span>
          {type && ` · ${type}`}
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={removing}
        aria-label={`Remove ${doc.filename}`}
        className="shrink-0 rounded-[var(--radius-sm)] border border-hair px-3 py-2 text-[12px] text-ink-2 transition-colors hover:border-crit hover:text-crit disabled:opacity-50"
      >
        {removing ? "Removing…" : "Remove"}
      </button>
    </li>
  );
}

function PendingRow({
  row,
  onRetry,
  onDismiss,
}: {
  row: PendingUpload;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const failed = row.state === "failed";
  return (
    <li className="rounded-[var(--radius-sm)] border border-hair bg-card px-3 py-2.5">
      <div className="flex items-center gap-3">
        <FileGlyph />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] text-ink">{row.name}</p>
          <p className="text-[12px] text-ink-3">
            {failed ? (
              "Not uploaded"
            ) : (
              <>
                Uploading <span className="tabular">{row.progress}%</span>
              </>
            )}
          </p>
        </div>
        {failed && (
          <>
            <button
              type="button"
              onClick={onRetry}
              aria-label={`Try uploading ${row.name} again`}
              className="shrink-0 rounded-[var(--radius-sm)] border border-hair px-3 py-2 text-[12px] text-ink-2 transition-colors hover:border-accent hover:text-accent"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={onDismiss}
              aria-label={`Dismiss ${row.name}`}
              className="shrink-0 rounded-[var(--radius-sm)] border border-hair px-3 py-2 text-[12px] text-ink-3 transition-colors hover:border-crit hover:text-crit"
            >
              Dismiss
            </button>
          </>
        )}
      </div>

      {!failed && (
        <div
          role="progressbar"
          aria-label={`Uploading ${row.name}`}
          aria-valuenow={row.progress}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-2 h-1 w-full overflow-hidden rounded bg-card-2"
        >
          <div
            className="h-full bg-accent transition-[width]"
            style={{ width: `${row.progress}%` }}
          />
        </div>
      )}
      {failed && row.errorMessage && (
        <p role="alert" className="mt-1.5 text-[12px] text-crit">
          {row.errorMessage}
        </p>
      )}
    </li>
  );
}

// ─── Glyphs ──────────────────────────────────────────────────────────────────

function UploadGlyph() {
  return (
    <svg
      className="mx-auto h-7 w-7 text-ink-3"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function FileGlyph() {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-ink-3"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
