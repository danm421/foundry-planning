// src/lib/ops/growth/accounts.ts
//
// The combined trials + cancellations table. Pure.
//
// One row per FIRM, not one per event. A firm that is trialing and has also
// canceled used to appear twice in the digest — once under each heading, with
// nothing to say it was the same account — and every trial more than
// TRIAL_ENDING_DAYS out was missing entirely. This builder answers a different
// question from attention.ts's "what needs you today": it is the standing
// roster of everyone whose money is in play.
import { CANCELED_WITHIN_DAYS } from "./attention";
import { daysBetween, type ClerkUserInput, type GrowthInput } from "./types";

export type AccountRow = {
  firm: string;
  /** The firm's earliest-joined member — the person who signed the firm up. */
  contactName: string | null;
  contactEmail: string | null;
  /** Members beyond the contact, so a multi-seat firm is not misread as one person. */
  otherMembers: number;
  /** Whole days left in the trial; null when the firm is not trialing. */
  trialDaysLeft: number | null;
  /** null when nothing is canceled. US spelling, as everywhere else here. */
  canceled: "Canceled" | "Canceling at period end" | null;
  /** ISO timestamp of the cancellation, for sorting. */
  canceledAt: string | null;
};

function fullName(u: ClerkUserInput): string | null {
  return [u.firstName, u.lastName].filter(Boolean).join(" ") || null;
}

export function buildAccountRows(input: GrowthInput): AccountRow[] {
  const { firms, subs, users, now } = input;
  const firmById = new Map(firms.map((f) => [f.firmId, f]));

  // Sorted once, before bucketing, so each firm's list arrives oldest-first
  // and the contact is simply its head.
  const membersByFirm = new Map<string, ClerkUserInput[]>();
  for (const u of [...users].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    for (const firmId of u.firmIds) {
      const bucket = membersByFirm.get(firmId);
      if (bucket) bucket.push(u);
      else membersByFirm.set(firmId, [u]);
    }
  }

  const rows: AccountRow[] = [];
  for (const s of subs) {
    const firm = firmById.get(s.firmId);
    // A founder firm pays nothing, and a subscription whose firm row is gone
    // has no name to show — neither belongs on a revenue roster.
    if (!firm || firm.isFounder) continue;

    const trialing = s.status === "trialing";
    const canceledRecently =
      s.canceledAt !== null && daysBetween(s.canceledAt, now) <= CANCELED_WITHIN_DAYS;
    if (!trialing && !canceledRecently) continue;

    // Earliest account = whoever created the org, in every real case. Clerk
    // roles would be the precise answer but every firm on prod is one seat,
    // so `otherMembers` carries the doubt instead of a second API call.
    const members = membersByFirm.get(s.firmId) ?? [];
    const contact = members[0];

    rows.push({
      firm: firm.displayName ?? "(unnamed)",
      contactName: contact ? fullName(contact) : null,
      contactEmail: contact?.email ?? null,
      otherMembers: Math.max(0, members.length - 1),
      // Floor, not round: half a day left is still "today", never "tomorrow".
      trialDaysLeft:
        trialing && s.trialEnd ? Math.floor(daysBetween(now, s.trialEnd)) : null,
      canceled: !canceledRecently
        ? null
        : s.cancelAtPeriodEnd
          ? "Canceling at period end"
          : "Canceled",
      canceledAt: canceledRecently ? s.canceledAt!.toISOString() : null,
    });
  }

  // Trials first, soonest to expire at the top — that is the order Dan works
  // the list in. Cancellations with no live trial fall below, newest first.
  return rows.sort((a, b) => {
    if (a.trialDaysLeft !== null && b.trialDaysLeft !== null) {
      return a.trialDaysLeft - b.trialDaysLeft;
    }
    if (a.trialDaysLeft !== null) return -1;
    if (b.trialDaysLeft !== null) return 1;
    return (b.canceledAt ?? "").localeCompare(a.canceledAt ?? "");
  });
}
