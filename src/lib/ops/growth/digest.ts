// src/lib/ops/growth/digest.ts
//
// Attention rows → the morning email, or null when there is nothing to say.
// Plain text on purpose: this is one person's inbox, not a campaign.
import type { AttentionKind, AttentionRow } from "./attention";

const HEADINGS: Record<AttentionKind, string> = {
  trial_ending: "Trials ending",
  canceled: "Cancellations",
  signed_in_not_working: "Signing in, building nothing",
  paywall_blocked: "Blocked by billing",
  stalled_checkout: "Stalled at checkout",
  new_signup: "New signups",
};

const ORDER: AttentionKind[] = [
  "canceled",
  "trial_ending",
  "stalled_checkout",
  "signed_in_not_working",
  "paywall_blocked",
  "new_signup",
];

export function buildDigest(
  rows: AttentionRow[],
  dashboardUrl: string,
): { subject: string; text: string } | null {
  // A quiet day sends nothing. See the module comment in
  // src/app/api/cron/notification-digest/route.ts for why this rule exists.
  if (rows.length === 0) return null;

  const n = rows.length;
  const subject = `Foundry: ${n} thing${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} you`;

  const sections: string[] = [];
  for (const kind of ORDER) {
    const group = rows.filter((r) => r.kind === kind);
    if (group.length === 0) continue;
    const lines = group.map((r) => {
      const who = r.email ? `${r.who} <${r.email}>` : r.who;
      return `  - ${who} — ${r.headline}`;
    });
    sections.push(`${HEADINGS[kind]}\n${lines.join("\n")}`);
  }

  const text = `${sections.join("\n\n")}\n\nFull dashboard: ${dashboardUrl}\n`;
  return { subject, text };
}
