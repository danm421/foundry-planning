// src/components/reports/use-autosave.ts
//
// Debounced autosave for the report builder. PATCHes the report tree
// after 1.5s of idle, retries with exponential backoff capped at 30s on
// failure, and re-tries on focus / visibilitychange when in error state.

"use client";
import { useEffect, useRef, useState } from "react";
import type { ReportState } from "@/lib/reports/reducer";
import type { SaveStatus } from "./autosave-indicator";

const DEBOUNCE_MS = 1500;
const MAX_BACKOFF_MS = 30_000;

export function useAutosave({
  clientId,
  reportId,
  state,
  initial,
}: {
  clientId: string;
  reportId: string;
  state: ReportState;
  initial: ReportState;
}): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const lastSavedRef = useRef<string>(JSON.stringify(initial));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(0);

  async function save(payload: ReportState) {
    setStatus("saving");
    try {
      const res = await fetch(`/api/clients/${clientId}/reports/${reportId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: payload.title, pages: payload.pages }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      lastSavedRef.current = JSON.stringify(payload);
      backoffRef.current = 0;
      setStatus("saved");
    } catch {
      setStatus("error");
      backoffRef.current = Math.min(
        MAX_BACKOFF_MS,
        (backoffRef.current || 1000) * 2,
      );
      setTimeout(() => save(payload), backoffRef.current);
    }
  }

  useEffect(() => {
    const serialized = JSON.stringify(state);
    if (serialized === lastSavedRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => save(state), DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Retry-on-focus
  useEffect(() => {
    function onFocus() {
      if (status === "error") save(state);
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, state]);

  return status;
}
