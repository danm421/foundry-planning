"use client";

import { useEffect, useRef, useState } from "react";

type ExtractionStatus = "queued" | "extracting" | "success" | "failed";
type ImportStatus = "draft" | "extracting" | "review" | "committed" | "discarded";

interface PollFile {
  id: string;
  originalFilename: string;
  documentType: string;
  latestExtraction: {
    status: ExtractionStatus;
    errorMessage: string | null;
  } | null;
}

interface PollResponse {
  import: {
    status: ImportStatus;
  };
  files: PollFile[];
}

interface ExtractionProgressProps {
  clientId: string;
  importId: string;
  /**
   * Fires when import.status flips out of "extracting" (typically to
   * "review", "committed", or "discarded"). Parent typically calls
   * router.refresh() so the server component re-fetches the new state.
   */
  onTerminal?: (newStatus: ImportStatus) => void;
  /** Polling interval in ms. Defaults to 1500. */
  intervalMs?: number;
}

export default function ExtractionProgress({
  clientId,
  importId,
  onTerminal,
  intervalMs = 1500,
}: ExtractionProgressProps) {
  const [data, setData] = useState<PollResponse | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  // Pin the latest callback so re-renders don't restart the poll loop.
  const onTerminalRef = useRef(onTerminal);
  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ac = new AbortController();

    const tick = async () => {
      try {
        const res = await fetch(
          `/api/clients/${clientId}/imports/${importId}`,
          { signal: ac.signal },
        );
        if (cancelled) return;
        if (!res.ok) {
          setPollError(`Failed to load import (${res.status})`);
          timer = setTimeout(tick, intervalMs);
          return;
        }
        const body = (await res.json()) as PollResponse;
        if (cancelled) return;
        setData(body);
        setPollError(null);
        if (body.import.status !== "extracting") {
          onTerminalRef.current?.(body.import.status);
          return;
        }
        timer = setTimeout(tick, intervalMs);
      } catch (err) {
        if (cancelled) return;
        if ((err as Error).name === "AbortError") return;
        setPollError((err as Error).message);
        timer = setTimeout(tick, intervalMs);
      }
    };

    tick();
    return () => {
      cancelled = true;
      ac.abort();
      if (timer) clearTimeout(timer);
    };
  }, [clientId, importId, intervalMs]);

  if (!data) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-gray-300">Extracting documents…</h3>
        {pollError ? (
          <p className="text-xs text-red-400">{pollError}</p>
        ) : (
          <p className="text-xs text-gray-400">Loading…</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-300">Extracting documents…</h3>
      {pollError ? (
        <p className="text-xs text-amber-400">
          Last poll failed ({pollError}). Retrying…
        </p>
      ) : null}
      {data.files.map((f) => {
        const status: ExtractionStatus = f.latestExtraction?.status ?? "queued";
        return (
          <div
            key={f.id}
            className="flex items-center gap-3 rounded-md border border-gray-700 bg-gray-900 px-3 py-2"
          >
            <StatusIndicator status={status} />
            <span className="min-w-0 flex-1 truncate text-sm text-gray-200">
              {f.originalFilename}
            </span>
            <span className="text-xs capitalize text-gray-400">{status}</span>
            {status === "failed" && f.latestExtraction?.errorMessage ? (
              <span
                className="max-w-[300px] truncate text-xs text-red-400"
                title={f.latestExtraction.errorMessage}
              >
                {f.latestExtraction.errorMessage}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function StatusIndicator({ status }: { status: ExtractionStatus }) {
  if (status === "extracting") {
    return (
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-600 border-t-accent" />
    );
  }
  if (status === "success") {
    return (
      <svg
        className="h-4 w-4 text-green-400"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (status === "failed") {
    return <div className="h-4 w-4 rounded-full bg-red-500" />;
  }
  return <div className="h-4 w-4 rounded-full bg-gray-600" />;
}
