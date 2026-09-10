"use client";

import { useCallback, useRef, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/card";
import UploadZone, { type InitialUploadedFile } from "@/components/import/upload-zone";
import { StepLine } from "@/components/statement-chat/step-line";
import AccountsTable from "@/components/statement-chat/accounts-table";
import { useChatCommit, type ChatCommitResult } from "@/components/statement-chat/use-chat-commit";

type ChatExtractEvent =
  | {
      type: "file";
      fileName: string;
      accountCount: number;
      statementDate?: string;
      error?: string;
    }
  | ({ type: "done" } & ChatCommitResult)
  | { type: "error"; message: string };

/**
 * Parse `data: <json>\n\n` SSE frames into the typed event union. Stateless
 * generator over a buffer, adapted from `parseForgeSse`
 * (`src/components/forge/use-forge-stream.ts`) — yields each complete frame
 * and RETURNS the trailing partial frame so the caller carries it forward.
 */
function* parseChatExtractSse(buffer: string): Generator<ChatExtractEvent, string> {
  let cursor = 0;
  for (;;) {
    const boundary = buffer.indexOf("\n\n", cursor);
    if (boundary === -1) return buffer.slice(cursor);
    const block = buffer.slice(cursor, boundary);
    cursor = boundary + 2;
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("data: ")) data += line.slice("data: ".length);
    }
    if (data) {
      try {
        yield JSON.parse(data) as ChatExtractEvent;
      } catch {
        // A malformed frame shouldn't kill the stream; skip it.
      }
    }
  }
}

type Status = "idle" | "streaming" | "done" | "error";

interface ChatSurfaceProps {
  clientId: string;
  importId: string;
  initialFiles: InitialUploadedFile[];
}

export function ChatSurface({ clientId, importId, initialFiles }: ChatSurfaceProps) {
  const [uploadedCount, setUploadedCount] = useState(initialFiles.length);
  const [status, setStatus] = useState<Status>("idle");
  const [fileEvents, setFileEvents] = useState<Array<Extract<ChatExtractEvent, { type: "file" }>>>(
    [],
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Everything downstream of a completed extraction — the working table,
  // which rows are locked, and closing the import (Task 10b) — lives in
  // this hook; see its own docstring for why it was split out.
  const {
    result,
    committedRowIds,
    finalizeStatus,
    finalizeError,
    resetForNewExtraction,
    applyExtractionResult,
    handleCommitRows,
    handleEditCell,
    handleRestore,
    handleFinalize,
  } = useChatCommit(clientId, importId);

  const runExtraction = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setStatus("streaming");
    setErrorMessage(null);
    setFileEvents([]);
    resetForNewExtraction();

    let res: Response;
    try {
      res = await fetch(`/api/clients/${clientId}/imports/${importId}/chat/extract`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
        signal: ac.signal,
      });
    } catch (err) {
      if (ac.signal.aborted) return;
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Could not reach the server.");
      return;
    }

    if (!res.ok || !res.body) {
      // Rate limiting fails closed (Global Constraint) — 503/429 land here
      // with a JSON `{ error }` body, never a silently-stuck spinner.
      const body = await res.json().catch(() => ({}) as { error?: string });
      const retryAfter = res.headers.get("retry-after");
      setStatus("error");
      setErrorMessage(
        (body.error ?? `Request failed (HTTP ${res.status}).`) +
          (retryAfter ? ` Retry in ${retryAfter}s.` : ""),
      );
      return;
    }

    try {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const it = parseChatExtractSse(buffer);
        let next = it.next();
        while (!next.done) {
          const ev = next.value;
          if (ev.type === "file") {
            setFileEvents((prev) => [...prev, ev]);
          } else if (ev.type === "done") {
            applyExtractionResult(ev);
          } else if (ev.type === "error") {
            setErrorMessage(ev.message);
          }
          next = it.next();
        }
        buffer = next.value;
      }
      setStatus((s) => (s === "streaming" ? "done" : s));
    } catch (err) {
      if (ac.signal.aborted) return;
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "The connection dropped.");
    }
  }, [clientId, importId, resetForNewExtraction, applyExtractionResult]);

  const isStreaming = status === "streaming";
  const finished = status === "done" || status === "error";
  const hasFailure = fileEvents.some((e) => e.error);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">
            Statements
          </h2>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <UploadZone
            clientId={clientId}
            importId={importId}
            initialFiles={initialFiles}
            disabled={isStreaming}
            onUploaded={() => setUploadedCount((c) => c + 1)}
            onRemoved={() => setUploadedCount((c) => Math.max(0, c - 1))}
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-3">
              {uploadedCount === 0
                ? "Upload one or more account statements to get started."
                : `${uploadedCount} ${uploadedCount === 1 ? "file" : "files"} ready.`}
            </p>
            <button
              type="button"
              onClick={runExtraction}
              disabled={uploadedCount === 0 || isStreaming}
              className="rounded bg-accent px-5 py-2 text-sm font-medium text-accent-on hover:bg-accent/90 disabled:opacity-50"
            >
              {isStreaming
                ? "Reading statements…"
                : status === "done" || status === "error"
                  ? "Re-run extraction"
                  : "Extract statements"}
            </button>
          </div>
        </CardBody>
      </Card>

      {(isStreaming || fileEvents.length > 0) && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">Progress</h2>
          </CardHeader>
          <CardBody className="divide-y divide-hair">
            {fileEvents.map((e, i) => (
              <StepLine
                key={`${e.fileName}-${i}`}
                fileName={e.fileName}
                accountCount={e.accountCount}
                statementDate={e.statementDate}
                error={e.error}
              />
            ))}
            {isStreaming && fileEvents.length === 0 && (
              <p className="py-1.5 text-sm text-ink-3">Reading statements…</p>
            )}
          </CardBody>
        </Card>
      )}

      {errorMessage && (
        <Card className="border-crit/40">
          <CardBody>
            <p className="text-sm text-crit">{errorMessage}</p>
          </CardBody>
        </Card>
      )}

      {finished && result && (
        <>
          <Card>
            <CardBody className="flex flex-col gap-3">
              <p className="text-sm text-ink">{result.summary}</p>
              {result.caveats.length > 0 && (
                <ul className="flex flex-col gap-1.5 text-sm text-ink-3">
                  {result.caveats.map((c, i) => (
                    <li key={i} className="flex gap-2">
                      <span aria-hidden="true">·</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              )}
              {hasFailure && (
                <p className="text-sm text-ink-3">
                  One or more statements could not be read. The accounts below reflect the ones
                  that were.
                </p>
              )}
            </CardBody>
          </Card>

          {result.rows.length === 0 && result.excluded.length === 0 ? (
            <Card>
              <CardBody className="flex flex-col items-center gap-2 py-8 text-center">
                <p className="text-sm font-medium text-ink">
                  No accounts found in these statements.
                </p>
                <p className="text-sm text-ink-3">
                  Try a different file, or upload another statement above.
                </p>
              </CardBody>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">
                    Accounts
                  </h2>
                </CardHeader>
                <CardBody className="p-0">
                  <AccountsTable
                    rows={result.rows}
                    excluded={result.excluded}
                    committedRowIds={committedRowIds}
                    onCommitRows={handleCommitRows}
                    onEditCell={handleEditCell}
                    onRestore={handleRestore}
                  />
                </CardBody>
              </Card>

              <Card>
                <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-ink">
                      {finalizeStatus === "done" ? "Import closed." : "Done reviewing these statements?"}
                    </p>
                    <p className="text-sm text-ink-3">
                      {finalizeStatus === "done"
                        ? "Every committed account is now part of the client's plan."
                        : "Closing marks this import complete. You can still upload another statement first."}
                    </p>
                    {finalizeStatus === "error" && finalizeError && (
                      <p className="mt-1 text-sm text-crit">{finalizeError}</p>
                    )}
                  </div>
                  {finalizeStatus !== "done" && (
                    <button
                      type="button"
                      onClick={handleFinalize}
                      // No client-side "every row committed" precondition
                      // (Ruling 70 — VERIFY server-side rather than trust a
                      // client prediction of it): the finalize route is the
                      // one place that actually knows, and its 409 names how
                      // many rows remain, which is more useful than a
                      // disabled button with no visible reason why.
                      disabled={finalizeStatus === "pending"}
                      className="shrink-0 rounded bg-accent px-5 py-2 text-sm font-medium text-accent-on hover:bg-accent/90 disabled:opacity-50"
                    >
                      {finalizeStatus === "pending" ? "Closing…" : "Finish import"}
                    </button>
                  )}
                </CardBody>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
