// src/lib/ops/growth/digest.ts
//
// Attention rows + the accounts roster + the active-people roster → the morning
// email, or null when there is nothing to say.
//
// Two shapes on purpose. The two rosters are TABLES, because their facts are
// the same columns every day and a table is the only way to scan them.
// Everything else is still one line per event, because those rows share no
// columns.
//
// HTML with a plain-text twin: mail clients render text/plain in a
// proportional font, so a hand-aligned ASCII table does not line up in the one
// inbox this is written for.
import { escapeHtml } from "@/lib/html-escape";
import { EMAIL, EMAIL_FONT } from "@/lib/email/tokens";
import type { AccountRow } from "./accounts";
import type { ActivePersonRow } from "./active-people";
import { plural, type AttentionKind, type AttentionRow } from "./attention";
import { ACTIVE_WINDOW_DAYS } from "./types";

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
const PEOPLE_TITLE = "Most active people";

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
// nowrap: a column label is never worth wrapping, and without it a hyphenated
// one ("Last sign-in") breaks across two lines and doubles the header's height.
const HEAD = `padding:8px 10px;border-bottom:1px solid ${EMAIL.ink};font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:${EMAIL.muted};text-align:left;white-space:nowrap`;

/**
 * Every table in this mail has the same skeleton — heading, header row, one
 * <tr> per record — so only the CELLS differ. Callers hand over their own cell
 * strings, already escaped and free to carry a link or a colour, which is what
 * keeps this helper from having to know anything about either roster.
 */
function tableHtml(title: string, headers: string[], rows: string[][]): string {
  const head = headers.map((h) => `<th style="${HEAD}">${h}</th>`).join("");
  const body = rows
    .map((cells) => `<tr>${cells.map((c) => `<td style="${CELL}">${c}</td>`).join("")}</tr>`)
    .join("");
  return [
    `<h2 style="${H2}">${title}</h2>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:0 0 28px">`,
    `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`,
  ].join("");
}

/** The plain-text twin: one bullet per record, its fields em-dashed apart. */
function tableText(title: string, rows: string[][]): string {
  return `${title}\n${rows.map((r) => `  - ${r.join(" — ")}`).join("\n")}`;
}

function accountsHtml(accounts: AccountRow[]): string {
  return tableHtml(
    TABLE_TITLE,
    ["Firm", "Name", "Email", "Trial left", "Status"],
    accounts.map((r) => {
      const addr = r.contactEmail ? escapeHtml(r.contactEmail) : null;
      const email = addr
        ? `<a href="mailto:${addr}" style="color:${EMAIL.link}">${addr}</a>`
        : "—";
      const label = escapeHtml(statusLabel(r));
      // Canceled is the one fact worth a colour: it is the row Dan acts on.
      const status = r.canceled ? `<span style="color:${EMAIL.danger}">${label}</span>` : label;
      return [
        escapeHtml(r.firm),
        escapeHtml(nameLabel(r)),
        email,
        trialLabel(r.trialDaysLeft),
        status,
      ];
    }),
  );
}

function accountsText(accounts: AccountRow[]): string {
  return tableText(
    TABLE_TITLE,
    accounts.map((r) => {
      const who = r.contactEmail ? `${nameLabel(r)} <${r.contactEmail}>` : nameLabel(r);
      return [r.firm, who, `trial: ${trialLabel(r.trialDaysLeft)}`, statusLabel(r)];
    }),
  );
}

/**
 * Month and day, in UTC. No year and nothing relative: every row on this table
 * signed in within the last week by construction, and a fixed label cannot go
 * stale between the send and the read the way "2 days ago" can.
 */
function signInLabel(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "5 of 7" — the bare number would not say what the denominator is. */
const daysLabel = (r: ActivePersonRow) => `${r.daysActive} of ${ACTIVE_WINDOW_DAYS}`;

function peopleHtml(people: ActivePersonRow[]): string {
  return tableHtml(
    PEOPLE_TITLE,
    // The window is interpolated, never typed twice: a change to
    // ACTIVE_WINDOW_DAYS must move this header and `daysLabel` together.
    ["Firm", "Name", "Clients", "Days active", "Last sign-in", `Actions (${ACTIVE_WINDOW_DAYS}d)`],
    people.map((r) => [
      escapeHtml(r.firm),
      escapeHtml(r.name),
      String(r.clients),
      daysLabel(r),
      signInLabel(r.lastSignInAt),
      String(r.actions),
    ]),
  );
}

function peopleText(people: ActivePersonRow[]): string {
  return tableText(
    PEOPLE_TITLE,
    people.map((r) => [
      r.firm,
      r.name,
      plural(r.clients, "client"),
      `active ${daysLabel(r)} days`,
      `last sign-in ${signInLabel(r.lastSignInAt)}`,
      plural(r.actions, "action"),
    ]),
  );
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

export function buildDigest(input: {
  rows: AttentionRow[];
  accounts: AccountRow[];
  people: ActivePersonRow[];
  dashboardUrl: string;
}): { subject: string; text: string; html: string } | null {
  const { rows, accounts, people, dashboardUrl } = input;
  const others = rows.filter(inOrder);

  // A quiet day sends nothing. See the module comment in
  // src/app/api/cron/notification-digest/route.ts for why this rule exists.
  //
  // `people` is deliberately absent from this count. Someone is a little bit
  // active every single day, so an active-people table that counted toward the
  // send would turn this into a daily email forever — the exact thing the null
  // return exists to prevent. That table only ever rides along with a digest
  // that was already going out.
  const n = accounts.length + others.length;
  if (n === 0) return null;

  const subject = `Foundry: ${plural(n, "thing")} need${n === 1 ? "s" : ""} you`;
  const sections = otherSections(others);
  const table = accounts.length > 0;
  const who = people.length > 0;

  const text = [
    ...(table ? [accountsText(accounts)] : []),
    ...(who ? [peopleText(people)] : []),
    ...sections.map((s) => `${s.heading}\n${s.lines.map((l) => `  - ${l}`).join("\n")}`),
    `Full dashboard: ${dashboardUrl}\n`,
  ].join("\n\n");

  const html = [
    `<div style="${EMAIL_FONT};max-width:720px;margin:0 auto;padding:24px;color:${EMAIL.ink}">`,
    `<h1 style="font-size:16px;font-weight:600;margin:0 0 20px">${escapeHtml(subject)}</h1>`,
    ...(table ? [accountsHtml(accounts)] : []),
    ...(who ? [peopleHtml(people)] : []),
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
