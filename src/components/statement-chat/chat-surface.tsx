"use client";

import { useCallback, useRef, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/card";
import UploadZone, { type InitialUploadedFile } from "@/components/import/upload-zone";
import { StepLine } from "@/components/statement-chat/step-line";
import AccountsTable from "@/components/statement-chat/accounts-table";
import { ChatTranscript } from "@/components/statement-chat/chat-transcript";
import { ChatComposer } from "@/components/statement-chat/chat-composer";
import { useChatCommit, type ChatCommitResult } from "@/components/statement-chat/use-chat-commit";
import { useChatTurn } from "@/components/statement-chat/use-chat-turn";

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
  initialExtractHoldings?: boolean;
}

export function ChatSurface({
  clientId,
  importId,
  initialFiles,
  initialExtractHoldings,
}: ChatSurfaceProps) {
  const [uploadedCount, setUploadedCount] = useState(initialFiles.length);
  const [status, setStatus] = useState<Status>("idle");
  const [extractHoldings, setExtractHoldings] = useState(initialExtractHoldings ?? false);
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
    transcript,
    finalizeStatus,
    finalizeError,
    resetForNewExtraction,
    applyExtractionResult,
    appendTurnEntries,
    flushRowsToServer,
    adoptTurnPayload,
    handleCommitRows,
    handleEditCell,
    handleRestore,
    handleFinalize,
  } = useChatCommit(clientId, importId);

  // Sends a turn and adopts what comes back (Task 11b, Steps 2/3). On the
  // FIRST turn that has anything to adopt (`result` was still null — a
  // resumed draft with no extraction run this session), also mark the local
  // stream `status` "done" so the extracted-state panel below appears — but
  // ONLY from "idle" (Ruling 98): a turn that resolves while an extraction
  // is streaming must never flip `isStreaming` false out from under it.
  // This does NOT change how `finished` is computed (C3's scope limit), it
  // only drives the SAME `status` state a real extraction would have set.
  const { turnStatus, turnError, sendTurn } = useChatTurn({
    clientId,
    importId,
    flushRowsToServer,
    appendTurnEntries,
    adoptTurnPayload,
    onAdopted: () => setStatus((s) => (s === "idle" ? "done" : s)),
  });

  const toggleHoldings = useCallback(
    (next: boolean) => {
      // Optimistic, like UploadZone's own document-type PATCH: the advisor
      // sees the switch move, and the value that matters is read server-side
      // at the next extraction, not now.
      setExtractHoldings(next);
      fetch(`/api/clients/${clientId}/imports/${importId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ extractHoldings: next }),
      }).catch((err) => console.error("Failed to update holdings extraction:", err));
    },
    [clientId, importId],
  );

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
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-ink-3">
                <input
                  type="checkbox"
                  checked={extractHoldings}
                  onChange={(e) => toggleHoldings(e.target.checked)}
                  disabled={isStreaming || turnStatus === "sending"}
                  className="h-4 w-4 rounded border-hair accent-accent"
                />
                Extract holdings
              </label>
              <button
                type="button"
                onClick={runExtraction}
                // Ruling 98: also disabled while a turn is sending — a turn
                // that resolves DURING a fresh extraction must never be the
                // thing that re-enables this button (Ruling 63's second
                // clause, from the other direction).
                disabled={uploadedCount === 0 || isStreaming || turnStatus === "sending"}
                className="rounded bg-accent px-5 py-2 text-sm font-medium text-accent-on hover:bg-accent/90 disabled:opacity-50"
              >
                {isStreaming
                  ? "Reading statements…"
                  : status === "done" || status === "error"
                    ? "Re-run extraction"
                    : "Extract statements"}
              </button>
            </div>
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

      {/*
        C3 (Ruling 92) — deliberately its OWN condition, NOT nested inside
        `finished && result` below. That gate starts false and stays false
        for a resumed draft with no extraction run this session (`status`
        starts "idle" and only a fresh extraction in THIS render flips it),
        so a chat surface that put its own input behind that gate would be
        invisible exactly when the persisted transcript is worth reading —
        the same "producer nothing consumes" shape as Rulings 68, 81 and 89.
        Always rendered: an import with no extracted rows at all is a real
        state the turn route can still answer (brief C3).
      */}
      <Card className="flex flex-col">
        <CardHeader>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">
            Ask about these statements
          </h2>
        </CardHeader>
        <div className="border-b border-hair">
          <ChatTranscript transcript={transcript} />
        </div>
        {turnError && <p className="px-3 py-2 text-sm text-crit">{turnError}</p>}
        <ChatComposer onSend={sendTurn} disabled={isStreaming} sending={turnStatus === "sending"} />
      </Card>

      {/*
        Final review, I2: gated on `result` ALONE, not on this session's
        stream status. `result` is non-null only once something real has
        populated it — a completed extraction, an adopted turn, or (now) the
        mount hydration of a resumed draft — and `resetForNewExtraction`
        nulls it again the moment a fresh extraction starts, so a streaming
        pass still shows no stale table. The old `finished &&` clause was
        exactly what left a resumed draft rendering a transcript and a
        composer above nothing: `status` starts "idle" and only a fresh
        extraction in THIS render flips it.
      */}
      {result && (
        <>
          {/*
            Minor 8 (Task 11b fix round 1): `result.summary` is `""` for a
            result `adoptTurnPayload` synthesized on a resumed draft's first
            turn (never the model's reply — that already renders in the
            transcript above). Skip the whole card rather than showing an
            empty paragraph when there is nothing here to say.
          */}
          {(result.summary || result.caveats.length > 0 || hasFailure) && (
            <Card>
              <CardBody className="flex flex-col gap-3">
                {result.summary && <p className="text-sm text-ink">{result.summary}</p>}
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
          )}

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
                    // Ruling 95 / Finding 4: while a turn is sending, nothing
                    // may enqueue onto the same commit queue `flushRowsToServer`
                    // and `adoptTurnPayload` use — a commit that snuck in
                    // between the flush landing and the response coming back
                    // would lock in pre-turn values and desync the screen from
                    // the client's plan.
                    disableCommit={turnStatus === "sending"}
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
                      // Ruling 95 / Finding 4: also disabled while a turn is
                      // sending, for the same reason per-row Commit is above.
                      disabled={finalizeStatus === "pending" || turnStatus === "sending"}
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
