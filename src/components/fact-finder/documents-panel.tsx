"use client";
// src/components/fact-finder/documents-panel.tsx
// The documents part of the side panel: one line per document saying how its
// reading went, and the upload zone. `useDocuments` keeps the document list and
// runs the reads; the screen holds it, so a read carries on while the panel is
// closed. Imports only client-safe leaf modules from src/lib/fact-finder.
import { useCallback, useEffect, useRef, useState } from "react";
import UploadZone, { type UploadedFileInfo } from "@/components/import/upload-zone";
import { filesReading, isReadingNow, needsReading } from "@/lib/fact-finder/reading-status";
import type { FactFinderState, FFFileReading } from "@/lib/fact-finder/types";
import type { ClientDocumentView } from "@/lib/imports/client-documents";
import { AlertIcon, CircleCheckIcon, ClockIcon, LoaderIcon } from "./icons";
import type { FFScreenFile } from "./screen-types";
import { useReadStream, type ReadLine, type ReadStream } from "./use-read-stream";

/** How long after the last upload its read starts, so files dropped together share one read. */
export const READ_AFTER_UPLOAD_MS = 1500;
/** While files finish, the screen fetches the fact finder at most this often. */
export const REFRESH_THROTTLE_MS = 2000;
/** While a read started elsewhere is under way, the screen checks on it this often. */
export const POLL_READING_MS = 5000;

const HEADING_ID = "fact-finder-documents";
const RETRY_CLASS =
  "shrink-0 rounded border border-hair bg-card px-2.5 py-1 text-xs font-medium text-accent transition-colors hover:border-accent hover:bg-accent-wash hover:text-accent-ink";

export interface Documents {
  /** The import's documents: the page's and this visit's uploads, less the ones removed. */
  files: FFScreenFile[];
  /** Any document's name, removed ones included (their values stay on the screen). */
  fileName(fileId: string): string | undefined;
  read: ReadStream;
  /** A read starts as the screen opens, because some document still needs reading. */
  readsOnOpen: boolean;
  uploaded(info: UploadedFileInfo): void;
  removed(fileId: string): void;
  /** A document was removed this visit. */
  removedAny: boolean;
}

export function useDocuments({
  clientId,
  importId,
  initialFiles,
  state,
  refresh,
  adopt,
}: {
  clientId: string;
  importId: string;
  initialFiles: FFScreenFile[];
  /** The fact finder the screen shows now. */
  state: FactFinderState;
  /** `useFactFinder`'s `refresh`: fetches the saved fact finder and adopts it. */
  refresh: () => Promise<void>;
  /** `useFactFinder`'s `adopt`: a read refused because another tab saved the import carries the saved fact finder. */
  adopt: (fresh: FactFinderState) => void;
}): Documents {
  const [known, setKnown] = useState(initialFiles);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  // Files never read, or abandoned mid-read. A failed file waits for Retry: reading it
  // on every open would fail it again, and add another chat message saying so.
  const [readsOnOpen] = useState(() =>
    initialFiles.some((file) => {
      const reading = state.readings[file.id];
      return reading?.status !== "failed" && needsReading(reading, new Date());
    }),
  );
  const [, setChecks] = useState(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uploadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checking = useRef(false);
  const opened = useRef(false);

  const read = useReadStream({
    clientId,
    importId,
    adopt,
    onFileFinished: () => {
      if (refreshTimer.current) return;
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = null;
        void refresh();
      }, REFRESH_THROTTLE_MS);
    },
    onDone: () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
      void refresh();
    },
  });
  const { start } = read;

  useEffect(() => {
    // Once, even when development runs the effect twice.
    if (!readsOnOpen || opened.current) return;
    opened.current = true;
    start();
  }, [readsOnOpen, start]);

  // A read started elsewhere (another tab, or before a reload) is under way:
  // check on it until it ends. The screen's own read refreshes the screen as
  // files finish, so there are no checks while it runs.
  const readingElsewhere = !read.running && filesReading(state, new Date()).length > 0;
  useEffect(() => {
    if (!readingElsewhere) return;
    const timer = setInterval(() => {
      if (checking.current) return; // the last check hasn't been answered yet
      checking.current = true;
      void refresh().then(() => {
        checking.current = false;
        // Re-render even when nothing changed, so a reading that has gone stale drops out.
        setChecks((n) => n + 1);
      });
    }, POLL_READING_MS);
    return () => clearInterval(timer);
  }, [readingElsewhere, refresh]);

  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      if (uploadTimer.current) clearTimeout(uploadTimer.current);
    },
    [],
  );

  const uploaded = useCallback(
    (info: UploadedFileInfo) => {
      setKnown((prev) =>
        prev.some((file) => file.id === info.serverFileId)
          ? prev
          : [...prev, { id: info.serverFileId, name: info.name, documentType: "auto" }],
      );
      if (uploadTimer.current) clearTimeout(uploadTimer.current);
      uploadTimer.current = setTimeout(() => {
        uploadTimer.current = null;
        start();
      }, READ_AFTER_UPLOAD_MS);
    },
    [start],
  );
  const removed = useCallback((fileId: string) => setRemovedIds((prev) => [...prev, fileId]), []);

  return {
    files: known.filter((file) => !removedIds.includes(file.id)),
    fileName: (fileId) => known.find((file) => file.id === fileId)?.name ?? read.lines[fileId]?.fileName,
    read,
    readsOnOpen,
    uploaded,
    removed,
    removedAny: removedIds.length > 0,
  };
}

type LineState =
  | { kind: "reading" }
  | { kind: "read"; rows: number | undefined }
  | { kind: "failed"; reason: string | undefined }
  | { kind: "waiting" };

/** The live read's word on a file wins; otherwise what the fact finder last said. */
function lineState(line: ReadLine | undefined, reading: FFFileReading | undefined, now: Date): LineState {
  if (line) {
    if (line.status === "reading") return { kind: "reading" };
    if (line.status === "done") return { kind: "read", rows: line.rows };
    return { kind: "failed", reason: line.error };
  }
  if (isReadingNow(reading, now)) return { kind: "reading" };
  if (reading?.status === "done") return { kind: "read", rows: reading.rows };
  if (reading?.status === "failed") return { kind: "failed", reason: reading.reason };
  // Never read, or a reading abandoned long ago.
  return { kind: "waiting" };
}

function ReadSummary({ rows }: { rows: number | undefined }) {
  if (rows === undefined) return <>Read</>;
  if (rows === 0) return <>Read · nothing found</>;
  return (
    <>
      Read · <span className="tabular">{rows}</span> {rows === 1 ? "row" : "rows"}
    </>
  );
}

function ProgressLine({ name, state, onRetry }: { name: string; state: LineState; onRetry: () => void }) {
  return (
    <li className="flex items-start gap-2.5 py-2">
      <span className="mt-0.5 shrink-0">
        {state.kind === "reading" && <LoaderIcon className="h-4 w-4 animate-spin text-ink-3 motion-reduce:animate-none" />}
        {state.kind === "read" && <CircleCheckIcon className="h-4 w-4 text-good" />}
        {state.kind === "failed" && <AlertIcon className="h-4 w-4 text-crit" />}
        {state.kind === "waiting" && <ClockIcon className="h-4 w-4 text-ink-4" />}
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p title={name} className="truncate font-medium text-ink">
          {name}
        </p>
        {state.kind === "reading" && <p className="text-ink-3">Reading…</p>}
        {state.kind === "read" && (
          <p className="text-ink-3">
            <ReadSummary rows={state.rows} />
          </p>
        )}
        {state.kind === "failed" && (
          <>
            <p className="text-crit">Couldn&apos;t read</p>
            {state.reason && <p className="text-xs text-ink-3">{state.reason}</p>}
          </>
        )}
        {state.kind === "waiting" && <p className="text-ink-3">Waiting to read</p>}
      </div>
      {/* Waiting: never read, or a read abandoned elsewhere went stale — nothing else will read it now. */}
      {(state.kind === "failed" || state.kind === "waiting") && (
        <button type="button" onClick={onRetry} aria-label={`Retry reading ${name}`} className={RETRY_CLASS}>
          Retry
        </button>
      )}
    </li>
  );
}

interface DocumentsPanelProps {
  clientId: string;
  importId: string;
  docs: Documents;
  state: FactFinderState;
  /** Files in the client's vault; one added is copied in, then read like any upload. */
  clientDocuments?: ClientDocumentView[];
}

export function DocumentsPanel({ clientId, importId, docs, state, clientDocuments }: DocumentsPanelProps) {
  const { read } = docs;
  const now = new Date();
  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3 p-4">
      <h3 id={HEADING_ID} className="text-xs font-semibold uppercase tracking-wide text-ink-3">
        Documents
      </h3>
      {read.error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-crit/30 bg-crit/15 px-3 py-2 text-sm text-crit"
        >
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="min-w-0 flex-1">{read.error}</p>
          <button type="button" onClick={read.start} className={RETRY_CLASS}>
            Retry
          </button>
        </div>
      )}
      {docs.files.length > 0 && (
        <ul aria-label="Reading progress" aria-live="polite" className="divide-y divide-hair">
          {docs.files.map((file) => (
            <ProgressLine
              key={file.id}
              name={file.name}
              state={lineState(read.lines[file.id], state.readings[file.id], now)}
              onRetry={read.start}
            />
          ))}
        </ul>
      )}
      <UploadZone
        clientId={clientId}
        importId={importId}
        initialFiles={docs.files.map((file) => ({ serverFileId: file.id, name: file.name, documentType: file.documentType }))}
        onUploaded={docs.uploaded}
        onRemoved={docs.removed}
        clientDocuments={clientDocuments}
        typePicker={false}
      />
      {docs.removedAny && (
        <p role="status" className="text-xs text-ink-3">
          Values read from it stay — remove those rows if you don&apos;t want them.
        </p>
      )}
    </section>
  );
}
