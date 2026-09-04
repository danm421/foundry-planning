// src/lib/ops/growth/attention.ts
//
// "Needs you" — the section that justifies the page. Pure.
// Every threshold is a named export so a test can pin its boundary.
import { buildFunnel } from "./funnel";
import { BLOCKED_ACTION, daysBetween, type GrowthInput } from "./types";

export const TRIAL_ENDING_DAYS = 3;
export const CANCELED_WITHIN_DAYS = 30;
export const QUIET_DAYS = 7;
export const PAYWALL_HIT_THRESHOLD = 5;
export const NEW_SIGNUP_DAYS = 1;

export type AttentionKind =
  | "trial_ending"
  | "canceled"
  | "signed_in_not_working"
  | "paywall_blocked"
  | "stalled_checkout"
  | "new_signup";

export type AttentionRow = {
  kind: AttentionKind;
  headline: string;
  who: string;
  email: string | null;
  firmId: string | null;
  /** ISO date of the thing that happened, for sorting and display. */
  at: string;
};

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export function buildAttention(input: GrowthInput): AttentionRow[] {
  const { firms, subs, activity, users, now } = input;
  const rows: AttentionRow[] = [];

  const firmById = new Map(firms.map((f) => [f.firmId, f]));
  const named = (firmId: string) => firmById.get(firmId)?.displayName ?? firmId;
  const billable = subs.filter((s) => !firmById.get(s.firmId)?.isFounder);

  for (const s of billable) {
    if (s.status === "trialing" && s.trialEnd) {
      const left = daysBetween(now, s.trialEnd);
      if (left >= 0 && left <= TRIAL_ENDING_DAYS) {
        rows.push({
          kind: "trial_ending",
          headline: `Trial ends in ${plural(Math.round(left), "day")}`,
          who: named(s.firmId),
          email: null,
          firmId: s.firmId,
          at: s.trialEnd.toISOString(),
        });
      }
    }
    if (s.canceledAt && daysBetween(s.canceledAt, now) <= CANCELED_WITHIN_DAYS) {
      rows.push({
        kind: "canceled",
        headline: "Cancelled",
        who: named(s.firmId),
        email: null,
        firmId: s.firmId,
        at: s.canceledAt.toISOString(),
      });
    }
  }

  // Signing in but building nothing — only meaningful while they are trialing.
  const trialingFirms = new Set(
    billable.filter((s) => s.status === "trialing").map((s) => s.firmId),
  );
  const quietCutoff = new Date(now.getTime() - QUIET_DAYS * 86_400_000);
  const workedRecently = new Set(
    activity
      .filter((a) => a.action !== BLOCKED_ACTION && a.createdAt >= quietCutoff)
      .map((a) => a.actorId),
  );
  for (const u of users) {
    const firmId = u.firmIds.find((id) => trialingFirms.has(id));
    if (!firmId) continue;
    if (!u.lastSignInAt || u.lastSignInAt < quietCutoff) continue;
    if (workedRecently.has(u.userId)) continue;
    rows.push({
      kind: "signed_in_not_working",
      headline: `Signing in but nothing built in ${plural(QUIET_DAYS, "day")}`,
      who: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || u.userId,
      email: u.email,
      firmId,
      at: u.lastSignInAt.toISOString(),
    });
  }

  // Repeated paywall hits — a blocked attempt is a signal, never work.
  const blockedByFirm = new Map<string, { n: number; last: Date }>();
  for (const a of activity) {
    if (a.action !== BLOCKED_ACTION) continue;
    if (a.createdAt < quietCutoff) continue;
    const prev = blockedByFirm.get(a.firmId);
    blockedByFirm.set(a.firmId, {
      n: (prev?.n ?? 0) + 1,
      last: prev && prev.last > a.createdAt ? prev.last : a.createdAt,
    });
  }
  for (const [firmId, { n, last }] of blockedByFirm) {
    if (n < PAYWALL_HIT_THRESHOLD) continue;
    rows.push({
      kind: "paywall_blocked",
      headline: `Blocked by billing ${plural(n, "time")}`,
      who: named(firmId),
      email: null,
      firmId,
      at: last.toISOString(),
    });
  }

  // New accounts and fresh stalls, straight off the funnel.
  const signupCutoff = new Date(now.getTime() - NEW_SIGNUP_DAYS * 86_400_000);
  for (const group of buildFunnel(input)) {
    if (group.stage !== "signed_up" && group.stage !== "stalled_checkout") continue;
    for (const p of group.people) {
      if (new Date(p.signedUpAt) < signupCutoff) continue;
      rows.push({
        kind: group.stage === "signed_up" ? "new_signup" : "stalled_checkout",
        headline:
          group.stage === "signed_up"
            ? "New account, hasn't started setup"
            : "Filled in setup, never paid",
        who: p.name,
        email: p.email,
        firmId: null,
        at: p.signedUpAt,
      });
    }
  }

  return rows.sort((a, b) => b.at.localeCompare(a.at));
}
