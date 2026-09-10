"use client";

import { useCallback, useRef, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/card";
import UploadZone, { type InitialUploadedFile } from "@/components/import/upload-zone";
import { StepLine } from "@/components/statement-chat/step-line";
import type { ExtractedAccount } from "@/lib/extraction/types";
import type { Annotated } from "@/lib/imports/types";

type Row = Annotated<ExtractedAccount>;
interface ExcludedRow {
  row: Row;
  reason: string;
}

type ChatExtractEvent =
  | {
      type: "file";
      fileName: string;
      accountCount: number;
      statementDate?: string;
      error?: string;
    }
  | { type: "done"; summary: string; caveats: string[]; rows: Row[]; excluded: ExcludedRow[] }
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

function money(n: number | undefined): string {
  if (n === undefined) return "—";
  return `$${Math.round(n).toLocaleString("en-US")}`;
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
  const [result, setResult] = useState<Extract<ChatExtractEvent, { type: "done" }> | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runExtraction = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setStatus("streaming");
    setErrorMessage(null);
    setFileEvents([]);
    setResult(null);

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
            setResult(ev);
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
  }, [clientId, importId]);

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

          {result.rows.length === 0 ? (
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
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">
                  Accounts
                </h2>
              </CardHeader>
              <CardBody className="overflow-x-auto p-0">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-hair text-xs uppercase tracking-wide text-ink-3">
                      <th className="px-4 py-2 font-medium">Account</th>
                      <th className="px-4 py-2 font-medium">Custodian</th>
                      <th className="px-4 py-2 font-medium">Category</th>
                      <th className="px-4 py-2 text-right font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row) => (
                      <tr key={row.__rowId ?? row.name} className="border-b border-hair last:border-0">
                        <td className="px-4 py-2 text-ink">{row.name}</td>
                        <td className="px-4 py-2 text-ink-3">{row.custodian ?? "—"}</td>
                        <td className="px-4 py-2 text-ink-3">{row.category ?? "—"}</td>
                        <td className="tabular px-4 py-2 text-right text-ink">
                          {money(row.value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          )}

          {result.excluded.length > 0 && (
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">
                  Not included
                </h2>
              </CardHeader>
              <CardBody className="flex flex-col gap-2">
                {result.excluded.map((x, i) => (
                  <p key={i} className="text-sm text-ink-4">
                    <span className="font-medium">{x.row.name}</span> — {x.reason}
                  </p>
                ))}
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
