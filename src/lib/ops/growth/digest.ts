// src/lib/ops/growth/digest.ts
//
// Attention rows + the accounts roster → the morning email, or null when there
// is nothing to say.
//
// Two shapes on purpose. The trials/cancellations roster is a TABLE, because
// its five facts (firm, who, their email, time left, whether they quit) are
// the same five every day and a table is the only way to scan them. Everything
// else is still one line per event, because those rows share no columns.
//
// HTML with a plain-text twin: mail clients render text/plain in a
// proportional font, so a hand-aligned ASCII table does not line up in the one
// inbox this is written for.
import { escapeHtml } from "@/lib/html-escape";
import { EMAIL, EMAIL_FONT } from "@/lib/email/tokens";
import type { AccountRow } from "./accounts";
import { plural, type AttentionKind, type AttentionRow } from "./attention";

/**
 * The kinds that still render as bullets. `trial_ending` and `canceled` are
 * absent because the accounts table owns them — this list is the ONLY place
 * that says so, so a kind cannot be dropped from the mail by accident.
 */
const ORDER = [
  "stalled_checkout",
  "signed_in_not_working",
  "paywall_blocked",
  "new_signup",
] as const satisfies readonly AttentionKind[];

const HEADINGS: Record<(typeof ORDER)[number], string> = {
  signed_in_not_working: "Signing in, building nothing",
  paywall_blocked: "Blocked by billing",
  stalled_checkout: "Stalled at checkout",
  new_signup: "New signups",
};

const TABLE_TITLE = "Trials and cancellations";

const inOrder = (r: AttentionRow) => (ORDER as readonly string[]).includes(r.kind);

/** null = not trialing. Negative means Stripe has not ended it yet. */
function trialLabel(days: number | null): string {
  if (days === null) return "—";
  if (days < 0) return "ended";
  if (days === 0) return "ends today";
  return plural(days, "day");
}

function nameLabel(row: AccountRow): string {
  const base = row.contactName ?? row.contactEmail ?? "unknown";
  return row.otherMembers > 0 ? `${base} +${row.otherMembers}` : base;
}

const statusLabel = (row: AccountRow): string => row.canceled ?? "Trialing";

const H2 = `font-size:13px;font-weight:600;margin:0 0 8px;color:${EMAIL.ink}`;
const CELL = `padding:8px 10px;border-bottom:1px solid ${EMAIL.hair};font-size:13px;vertical-align:top`;
const HEAD = `padding:8px 10px;border-bottom:1px solid ${EMAIL.ink};font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:${EMAIL.muted};text-align:left`;

function accountsHtml(accounts: AccountRow[]): string {
  const head = ["Firm", "Name", "Email", "Trial left", "Status"]
    .map((h) => `<th style="${HEAD}">${h}</th>`)
    .join("");

  const body = accounts
    .map((r) => {
      const addr = r.contactEmail ? escapeHtml(r.contactEmail) : null;
      const email = addr
        ? `<a href="mailto:${addr}" style="color:${EMAIL.link}">${addr}</a>`
        : "—";
      const label = escapeHtml(statusLabel(r));
      // Canceled is the one fact worth a colour: it is the row Dan acts on.
      const status = r.canceled ? `<span style="color:${EMAIL.danger}">${label}</span>` : label;
      const cells = [
        escapeHtml(r.firm),
        escapeHtml(nameLabel(r)),
        email,
        trialLabel(r.trialDaysLeft),
        status,
      ];
      return `<tr>${cells.map((c) => `<td style="${CELL}">${c}</td>`).join("")}</tr>`;
    })
    .join("");

  return [
    `<h2 style="${H2}">${TABLE_TITLE}</h2>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:0 0 28px">`,
    `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`,
  ].join("");
}

function accountsText(accounts: AccountRow[]): string {
  const lines = accounts.map((r) => {
    const who = r.contactEmail ? `${nameLabel(r)} <${r.contactEmail}>` : nameLabel(r);
    return `  - ${[r.firm, who, `trial: ${trialLabel(r.trialDaysLeft)}`, statusLabel(r)].join(" — ")}`;
  });
  return `${TABLE_TITLE}\n${lines.join("\n")}`;
}

/** The kinds the table does not own, grouped under their headings. */
function otherSections(rows: AttentionRow[]): Array<{ heading: string; lines: string[] }> {
  const out: Array<{ heading: string; lines: string[] }> = [];
  for (const kind of ORDER) {
    const group = rows.filter((r) => r.kind === kind);
    if (group.length === 0) continue;
    out.push({
      heading: HEADINGS[kind],
      lines: group.map((r) => `${r.email ? `${r.who} <${r.email}>` : r.who} — ${r.headline}`),
    });
  }
  return out;
}

export function buildDigest(
  rows: AttentionRow[],
  accounts: AccountRow[],
  dashboardUrl: string,
): { subject: string; text: string; html: string } | null {
  const others = rows.filter(inOrder);

  // A quiet day sends nothing. See the module comment in
  // src/app/api/cron/notification-digest/route.ts for why this rule exists.
  const n = accounts.length + others.length;
  if (n === 0) return null;

  const subject = `Foundry: ${plural(n, "thing")} need${n === 1 ? "s" : ""} you`;
  const sections = otherSections(others);
  const table = accounts.length > 0;

  const text = [
    ...(table ? [accountsText(accounts)] : []),
    ...sections.map((s) => `${s.heading}\n${s.lines.map((l) => `  - ${l}`).join("\n")}`),
    `Full dashboard: ${dashboardUrl}\n`,
  ].join("\n\n");

  const html = [
    `<div style="${EMAIL_FONT};max-width:720px;margin:0 auto;padding:24px;color:${EMAIL.ink}">`,
    `<h1 style="font-size:16px;font-weight:600;margin:0 0 20px">${escapeHtml(subject)}</h1>`,
    ...(table ? [accountsHtml(accounts)] : []),
    ...sections.map(
      (s) =>
        `<h2 style="${H2}">${s.heading}</h2>` +
        `<ul style="margin:0 0 28px;padding-left:18px;font-size:13px;line-height:1.7;color:${EMAIL.ink}">` +
        s.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("") +
        `</ul>`,
    ),
    `<p style="font-size:12px;color:${EMAIL.muted};margin:0"><a href="${escapeHtml(dashboardUrl)}" style="color:${EMAIL.link}">Full dashboard</a></p>`,
    `</div>`,
  ].join("");

  return { subject, text, html };
}
