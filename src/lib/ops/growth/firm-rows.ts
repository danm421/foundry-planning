// src/lib/ops/growth/firm-rows.ts
//
// The "All firms" table. Pure.
//
// Two date columns, deliberately: `lastSignInAt` is showing up, `lastActionAt`
// is doing work. Neither alone is a usage signal — the gap between them is what
// says a trial is quietly dying.
import type { GrowthInput } from "./types";

export type FirmRow = {
  firmId: string;
  displayName: string;
  isFounder: boolean;
  /** Active subscription status, or "founder", or "none". */
  status: string;
  seats: number;
  lastSignInAt: string | null;
  lastActionAt: string | null;
  clients: number;
};

function latest(dates: Array<Date | null>): string | null {
  let max: Date | null = null;
  for (const d of dates) if (d && (!max || d > max)) max = d;
  return max?.toISOString() ?? null;
}

export function buildFirmRows(input: GrowthInput): FirmRow[] {
  const { firms, subs, items, activity, users, clientCountByFirm } = input;
  const subByFirm = new Map(subs.map((s) => [s.firmId, s]));

  return firms.map((f) => ({
    firmId: f.firmId,
    displayName: f.displayName ?? "(unnamed)",
    isFounder: f.isFounder,
    status: f.isFounder ? "founder" : subByFirm.get(f.firmId)?.status ?? "none",
    seats: items
      .filter((i) => i.firmId === f.firmId && !i.removedAt)
      .reduce((n, i) => n + i.quantity, 0),
    lastSignInAt: latest(
      users.filter((u) => u.firmIds.includes(f.firmId)).map((u) => u.lastSignInAt),
    ),
    lastActionAt: latest(
      activity.filter((a) => a.firmId === f.firmId).map((a) => a.createdAt),
    ),
    clients: clientCountByFirm[f.firmId] ?? 0,
  }));
}
