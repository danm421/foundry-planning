/**
 * Helpers for the topbar quick-note flow. Pure (no window, no DB) so the
 * subject derivation is shared by the API route (server) and unit tests.
 */

const SUBJECT_MAX = 80;
const FALLBACK_SUBJECT = "Quick note";

/**
 * Derives a note subject from a markdown body: first non-empty line with
 * markdown syntax stripped, truncated to 80 chars. Falls back to "Quick note"
 * when nothing usable remains (empty body, marker-only line).
 */
export function deriveNoteSubject(markdown: string): string {
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine
      .trim()
      .replace(/^#{1,6}\s+/, "") // heading marker
      .replace(/^>\s+/, "") // blockquote marker
      .replace(/^([-*+]|\d+[.)])\s+/, "") // list marker
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // image → alt text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // link → link text
      .replace(/(\*\*|__|~~|\*|_|`)/g, "") // emphasis / code marks
      .trim();
    if (!line) continue;
    return line.length > SUBJECT_MAX ? `${line.slice(0, SUBJECT_MAX - 1).trimEnd()}…` : line;
  }
  return FALLBACK_SUBJECT;
}

/** Today's calendar date (YYYY-MM-DD) in the browser/server local timezone —
 *  same offset trick as the CRM note dialog, so the stored noon-UTC occurredAt
 *  displays as the date the advisor actually wrote the note. */
export function todayLocalDate(): string {
  const now = new Date();
  const off = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - off).toISOString().slice(0, 10);
}
