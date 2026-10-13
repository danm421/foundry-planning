// src/lib/fact-finder/reading-status.ts
// Whether a document is being read, needs reading, or is done. Client-safe:
// the read route, the chat route and the screen all ask the same question.
import type { FactFinderState, FFFileReading } from "./types";

/**
 * A file still "reading" after this long is treated as abandoned and read
 * again: the read route's maxDuration (300 s) plus 60 s.
 */
export const STALE_READING_MS = 6 * 60 * 1000;

export function needsReading(status: FFFileReading | undefined, now: Date): boolean {
  if (!status || status.status === "failed") return true;
  if (status.status === "reading") return now.getTime() - Date.parse(status.startedAt) > STALE_READING_MS;
  return false;
}

/** A read of this file is under way: "reading" and not yet stale. */
export function isReadingNow(status: FFFileReading | undefined, now: Date): boolean {
  return status?.status === "reading" && !needsReading(status, now);
}

/** Ids of the files being read right now. */
export function filesReading(state: FactFinderState, now: Date): string[] {
  return Object.entries(state.readings)
    .filter(([, status]) => isReadingNow(status, now))
    .map(([fileId]) => fileId);
}
