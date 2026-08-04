// src/lib/notifications/digest.ts
//
// Batch pending notification rows into one email per advisor, and render it.
// Pure — no IO, no clock, no Resend — so batching and layout are unit-testable.
import {
  CATEGORY_LABELS,
  DATE_CATEGORIES,
  type NotificationCategory,
} from "./catalog";
import { escapeHtml } from "@/lib/html-escape";

export type PendingRow = {
  id: string;
  userId: string;
  email: string;
  displayName: string | null;
  category: NotificationCategory;
  title: string;
  body: string | null;
  url: string;
  createdAt: Date;
};

export type DigestBatch = {
  userId: string;
  email: string;
  displayName: string | null;
  /** Capped, for rendering. */
  rows: PendingRow[];
  /** How many more exist beyond the cap. */
  truncated: number;
  /**
   * EVERY pending row id for this user — including the truncated ones. The
   * worker stamps all of them. Stamping only the rendered rows would leave a
   * backlog dripping out `maxPerUser` a day, each email staler than the last;
   * the "and N more" link sends them to /alerts where all of it is waiting.
   */
  allIds: string[];
};

export const MAX_ROWS_PER_EMAIL = 50;

export function planDigestBatches(
  rows: PendingRow[],
  maxPerUser: number,
): DigestBatch[] {
  const byUser = new Map<string, PendingRow[]>();
  for (const r of rows) {
    // No address, no email. The in-app row is unaffected.
    if (!r.email) continue;
    const list = byUser.get(r.userId);
    if (list) list.push(r);
    else byUser.set(r.userId, [r]);
  }

  const out: DigestBatch[] = [];
  for (const [userId, all] of byUser) {
    out.push({
      userId,
      email: all[0].email,
      displayName: all[0].displayName,
      rows: all.slice(0, maxPerUser),
      truncated: Math.max(0, all.length - maxPerUser),
      allIds: all.map((r) => r.id),
    });
  }
  return out;
}


// Inlined per element: Outlook drops most inherited styles, so anything that
// does not carry its own font-size falls back to the client default.
/* eslint-disable brand/no-raw-hex -- email HTML requires inline hex; email clients can't resolve CSS brand tokens (same rationale as src/lib/feedback/email.ts and src/lib/intake/email-template.ts) */
const WRAP =
  "font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a2233;";
const H1 = "font-size:16px;font-weight:600;margin:0 0 4px;";
const SUB = "font-size:13px;color:#64748b;margin:0 0 20px;";
const SECTION =
  "font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;margin:20px 0 8px;";
const ITEM =
  "font-size:14px;line-height:1.45;padding:8px 0;border-bottom:1px solid #f1f5f9;";
const LINK = "color:#1e3a5f;font-weight:600;text-decoration:none;";
const MUTED = "color:#64748b;font-size:12px;";
const FOOTER =
  "margin-top:28px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;";
/* eslint-enable brand/no-raw-hex */

function renderItem(row: PendingRow, origin: string): string {
  const href = row.url.startsWith("http") ? row.url : `${origin}${row.url}`;
  const body = row.body
    ? `<div style="${MUTED}">${escapeHtml(row.body)}</div>`
    : "";
  return (
    `<div style="${ITEM}">` +
    `<a href="${escapeHtml(href)}" style="${LINK}">${escapeHtml(row.title)}</a>` +
    body +
    `</div>`
  );
}

/**
 * The daily digest. The Dates section leads because it is the only forward-
 * looking content — everything else already happened and will still be there.
 */
export function renderDigestEmail(
  batch: DigestBatch,
  origin: string,
): { subject: string; html: string } {
  const greeting = batch.displayName
    ? `Hi ${escapeHtml(batch.displayName)},`
    : "Hi,";

  const dateRows = batch.rows.filter((r) => DATE_CATEGORIES.includes(r.category));
  const eventRows = batch.rows.filter((r) => !DATE_CATEGORIES.includes(r.category));

  let body = "";
  if (dateRows.length > 0) {
    body += `<div style="${SECTION}">Dates</div>`;
    body += dateRows.map((r) => renderItem(r, origin)).join("");
  }
  if (eventRows.length > 0) {
    // Group by category so five document uploads read as one block, not five
    // interleaved lines.
    const byCategory = new Map<NotificationCategory, PendingRow[]>();
    for (const r of eventRows) {
      const list = byCategory.get(r.category);
      if (list) list.push(r);
      else byCategory.set(r.category, [r]);
    }
    for (const [category, rows] of byCategory) {
      body += `<div style="${SECTION}">${escapeHtml(CATEGORY_LABELS[category])}</div>`;
      body += rows.map((r) => renderItem(r, origin)).join("");
    }
  }

  if (batch.truncated > 0) {
    body +=
      `<p style="${MUTED}margin-top:12px;">` +
      `<a href="${origin}/alerts" style="${LINK}">` +
      `and ${batch.truncated} more →</a></p>`;
  }

  const total = batch.rows.length + batch.truncated;
  return {
    subject: `${total} update${total === 1 ? "" : "s"} across your book`,
    html:
      `<div style="${WRAP}">` +
      `<h1 style="${H1}">${greeting}</h1>` +
      `<p style="${SUB}">${total} update${total === 1 ? "" : "s"} across your book.</p>` +
      body +
      `<p style="${FOOTER}">Foundry Planning · ` +
      `<a href="${origin}/alerts?tab=settings" style="${LINK}">manage these alerts</a>` +
      `</p></div>`,
  };
}
