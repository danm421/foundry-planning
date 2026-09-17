// src/lib/crm/notes-window.ts
//
// Pure windowing helpers for the notes MCP tools. NO db and NO next imports —
// this file must stay testable in plain vitest, mirroring
// src/lib/crm/meeting-prep/battery-core.ts.
import type { NoteKind, NoteRow } from "./notes";

/**
 * Bodies longer than this are cut and flagged. Set from production: notes
 * average 147 chars and p90 is 274, so this fires on roughly one note in
 * fifty — it exists for the 2,658-char outlier, not the common case.
 */
export const NOTE_BODY_MAX = 1000;
export const NOTE_LIMIT_DEFAULT = 20;
export const NOTE_LIMIT_MAX = 100;

export type NoteWindowOptions = {
  /** YYYY-MM-DD, inclusive from the start of that day (UTC). */
  since?: string;
  /** YYYY-MM-DD, inclusive to the end of that day (UTC). */
  until?: string;
  kinds?: NoteKind[];
};

export function clampNoteLimit(limit?: number): number {
  if (limit == null || !Number.isFinite(limit) || limit < 1) return NOTE_LIMIT_DEFAULT;
  return Math.min(Math.floor(limit), NOTE_LIMIT_MAX);
}

export function truncateNoteBody(body: string): { body: string; truncated: boolean } {
  if (body.length <= NOTE_BODY_MAX) return { body, truncated: false };
  const hardCut = body.slice(0, NOTE_BODY_MAX);
  const lastSpace = hardCut.lastIndexOf(" ");
  // Only break on a space if one exists in the tail of the cut; an unbroken
  // 1,000-char run (a pasted URL, a base64 blob) falls back to the hard cut
  // rather than returning almost nothing.
  const body_ = lastSpace > 0 ? hardCut.slice(0, lastSpace) : hardCut;
  return { body: body_, truncated: true };
}

export function filterNotesWindow(rows: NoteRow[], opts: NoteWindowOptions): NoteRow[] {
  // `since`/`until` are calendar days; notes are stored at noon UTC
  // (see noteDateToOccurredAt), so day-bounds at 00:00 and 23:59:59.999 make
  // both ends inclusive of a note entered on the boundary day.
  const sinceMs = opts.since ? Date.parse(`${opts.since}T00:00:00.000Z`) : null;
  const untilMs = opts.until ? Date.parse(`${opts.until}T23:59:59.999Z`) : null;
  const kinds = opts.kinds && opts.kinds.length > 0 ? new Set(opts.kinds) : null;

  return rows.filter((r) => {
    if (kinds && !kinds.has(r.kind)) return false;
    const at = Date.parse(r.occurredAt);
    if (sinceMs != null && at < sinceMs) return false;
    if (untilMs != null && at > untilMs) return false;
    return true;
  });
}
