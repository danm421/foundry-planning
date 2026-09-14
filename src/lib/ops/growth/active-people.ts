// src/lib/ops/growth/active-people.ts
//
// "Who is actually using Foundry this week, and how much of it is theirs?" Pure.
//
// One row per PERSON, where firm-rows.ts is one row per firm. A firm's totals
// hide the thing Dan is looking for here: whether the work inside an account is
// one advisor carrying it or a whole team, and whether the people doing the
// work are the ones with households to serve.
//
// There is no sign-in COUNT to show — the audit log records no sign-in action
// and Clerk exposes only a single lastSignInAt — so "days active" is the
// repeat-usage column instead: showing up seven days running is a habit,
// showing up once for forty actions is a spike.
import {
  ACTIVE_WINDOW_DAYS,
  displayName,
  workDoneSince,
  type ActivityInput,
  type GrowthInput,
} from "./types";

export type ActivePersonRow = {
  /** The firm the work happened in — see `busiestFirm` for multi-firm people. */
  firm: string;
  /** Clerk name, else their email, else the raw user id. Never blank. */
  name: string;
  /** Households this person is the advisor on, across every firm. */
  clients: number;
  /** Distinct UTC dates inside the window on which they did real work. */
  daysActive: number;
  /** ISO timestamp, or null when Clerk has never seen them sign in. */
  lastSignInAt: string | null;
  /** Qualifying actions inside the window. Blocked paywall hits are not work. */
  actions: number;
};

/**
 * The firm a multi-firm person is filed under: the one they did the most work
 * in over the window, ties broken by the displayed name so the row does not
 * move between two equally busy firms from one morning to the next.
 *
 * Attributing by WORK rather than by Clerk membership is deliberate — a
 * consultant who belongs to four orgs and only ever opens one belongs on the
 * line of the firm they actually serve.
 */
function busiestFirm(rows: ActivityInput[], nameOf: (firmId: string) => string): string {
  const tally = new Map<string, number>();
  for (const r of rows) tally.set(r.firmId, (tally.get(r.firmId) ?? 0) + 1);

  let best = "";
  let bestCount = -1;
  for (const [firmId, count] of tally) {
    const label = nameOf(firmId);
    if (count > bestCount || (count === bestCount && label.localeCompare(best) < 0)) {
      best = label;
      bestCount = count;
    }
  }
  return best;
}

export function buildActivePeople(input: GrowthInput): ActivePersonRow[] {
  const { firms, activity, users, clientCountByAdvisor, now } = input;

  const firmById = new Map(firms.map((f) => [f.firmId, f]));
  // Fall back to the id, as attention.ts does: a firm row that has been deleted
  // still leaves audit rows behind, and the id is more use than "(unnamed)".
  const nameOf = (firmId: string) => firmById.get(firmId)?.displayName ?? firmId;
  const userById = new Map(users.map((u) => [u.userId, u]));

  const since = new Date(now.getTime() - ACTIVE_WINDOW_DAYS * 86_400_000);
  const byActor = new Map<string, ActivityInput[]>();
  for (const row of workDoneSince(activity, since)) {
    const bucket = byActor.get(row.actorId);
    if (bucket) bucket.push(row);
    else byActor.set(row.actorId, [row]);
  }

  const rows: ActivePersonRow[] = [];
  for (const [actorId, done] of byActor) {
    const user = userById.get(actorId);
    const days = new Set(done.map((r) => r.createdAt.toISOString().slice(0, 10)));
    rows.push({
      firm: busiestFirm(done, nameOf),
      // An actor with no Clerk account at all — deleted, or never synced — is
      // still someone who did the work, so the id stands in for the name.
      name: user ? displayName(user) : actorId,
      clients: clientCountByAdvisor[actorId] ?? 0,
      // A rolling 7×24h window straddles eight calendar dates, so the count is
      // capped: the column says "of last 7" and 8 of 7 is not a number.
      daysActive: Math.min(days.size, ACTIVE_WINDOW_DAYS),
      lastSignInAt: user?.lastSignInAt?.toISOString() ?? null,
      actions: done.length,
    });
  }

  // Most active first: days before volume, because a habit beats a spike.
  return rows.sort(
    (a, b) =>
      b.daysActive - a.daysActive || b.actions - a.actions || a.name.localeCompare(b.name),
  );
}
