/**
 * Mention tokens for CRM task comments.
 *
 * A mention is embedded in `bodyMarkdown` as `@[Display Name](user:<clerkUserId>)`.
 * The display name is a snapshot taken when the comment was written; the
 * Clerk user id is canonical. Pure module — no server/DB imports — so the
 * route handler, mutation, and client renderer all share it.
 */

export interface MentionPick {
  displayName: string;
  userId: string;
}

export type MentionSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; displayName: string; userId: string };

// Names: no `]` or newlines (sanitized at serialize time), 1–80 chars.
// Ids: Clerk user ids are alphanumeric/underscore/hyphen.
const MENTION_TOKEN_RE = /@\[([^\]\n]{1,80})\]\(user:([A-Za-z0-9_-]+)\)/g;

export function mentionToken(displayName: string, userId: string): string {
  const safeName =
    displayName.replace(/[\[\]\n]/g, " ").replace(/\s+/g, " ").trim() || "member";
  return `@[${safeName}](user:${userId})`;
}

export function splitMentionSegments(body: string): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let last = 0;
  for (const m of body.matchAll(MENTION_TOKEN_RE)) {
    if (m.index > last) segments.push({ kind: "text", text: body.slice(last, m.index) });
    segments.push({ kind: "mention", displayName: m[1], userId: m[2] });
    last = m.index + m[0].length;
  }
  if (last < body.length) segments.push({ kind: "text", text: body.slice(last) });
  return segments;
}

export function extractMentionUserIds(body: string): string[] {
  const ids = new Set<string>();
  for (const seg of splitMentionSegments(body)) {
    if (seg.kind === "mention") ids.add(seg.userId);
  }
  return [...ids];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace `@Display Name` text the composer inserted with mention tokens.
 * Longest names first so `@Jane Smith` wins over a `@Jane` pick; the
 * lookahead keeps `@Jane Smithson` from matching a `Jane Smith` pick.
 * If two members share a display name, the first pick wins — accepted v1.
 */
export function insertMentionTokens(body: string, picks: MentionPick[]): string {
  const byName = new Map<string, MentionPick>();
  for (const p of picks) if (!byName.has(p.displayName)) byName.set(p.displayName, p);
  const ordered = [...byName.values()].sort(
    (a, b) => b.displayName.length - a.displayName.length,
  );
  let out = body;
  for (const pick of ordered) {
    const re = new RegExp(`@${escapeRegExp(pick.displayName)}(?![A-Za-z0-9])`, "g");
    out = out.replace(re, mentionToken(pick.displayName, pick.userId));
  }
  return out;
}

/**
 * Composer helper: the active mention query at the caret, or null.
 * An `@` opens a query only at the start of the text or after whitespace;
 * the query ends at the caret and dies on newline, a second `@`, or >40 chars.
 */
export function findMentionQuery(
  value: string,
  caret: number,
): { start: number; query: string } | null {
  const at = value.lastIndexOf("@", caret - 1);
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(value[at - 1])) return null;
  const query = value.slice(at + 1, caret);
  if (query.length > 40 || query.includes("\n") || query.includes("@")) return null;
  return { start: at, query };
}
