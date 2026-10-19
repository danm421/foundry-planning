import type { ProviderId } from "@/lib/integrations/types";
import { plaidIssueOf, type PlaidIssue } from "@/lib/plaid/errors";

/** Firm integrations that sync accounts — every provider but the AI one. */
type AccountIntegration = Exclude<ProviderId, "azure_openai">;

/** What keeps a connected account's balance current: the client's own Plaid
 *  link, or one of the firm's integrations. A row with none is typed in by
 *  hand. */
export type LinkedSource = "plaid" | AccountIntegration;

/** Keyed by every LinkedSource, so a new integration fails to compile until it
 *  is named here. */
export const LINKED_SOURCE_NAME: Record<LinkedSource, string> = {
  plaid: "Plaid",
  orion: "Orion",
  schwab: "Schwab",
  addepar: "Addepar",
};

export function linkedSourceLabel(source: LinkedSource): string {
  return source === "plaid" ? "Linked via Plaid" : `Synced from ${LINKED_SOURCE_NAME[source]}`;
}

function isIntegration(v: string | null | undefined): v is AccountIntegration {
  return v != null && v !== "plaid" && Object.hasOwn(LINKED_SOURCE_NAME, v);
}

/** `plaidItemId` is the reliable Plaid signal — `source` can lag until holdings
 *  ingest, and stays "plaid" after the institution is unlinked (the FK nulls).
 *  An integration sync stamps both `externalProvider` and `source`. */
export function linkedSourceOf(row: {
  plaidItemId: string | null;
  externalProvider?: string | null;
  source?: string | null;
}): LinkedSource | null {
  if (row.plaidItemId != null) return "plaid";
  if (isIntegration(row.externalProvider)) return row.externalProvider;
  if (isIntegration(row.source)) return row.source;
  return null;
}

/** A firm integration keeps this account current, so the client portal treats
 *  it as read-only: the next sync would overwrite a client's edit, and a
 *  deleted account would come back with it. */
export function isFirmSynced(row: Parameters<typeof linkedSourceOf>[0]): boolean {
  const source = linkedSourceOf(row);
  return source != null && source !== "plaid";
}

const LINKED_ISSUE_TEXT: Record<PlaidIssue, string> = {
  reconnect: "Needs reconnecting",
  revoked: "Access revoked",
};

/** Everything the link icon's hover says about a connected balance. */
export interface LinkedStatus {
  source: LinkedSource;
  /** ISO time the connection last refreshed the balance; null = never yet. */
  syncedAt: string | null;
  /** A broken Plaid link — the balance has stopped updating until the client
   *  acts. Integrations have no per-client equivalent. */
  issue: PlaidIssue | null;
}

/** Plaid refreshes per bank connection, so a Plaid account is dated by its
 *  item's `lastRefreshedAt` (joined in by the caller); an integration stamps
 *  each account's own `lastSyncedAt`. */
export function linkedStatusOf(
  row: Parameters<typeof linkedSourceOf>[0] & {
    lastSyncedAt?: Date | null;
    plaidRefreshedAt?: Date | null;
    plaidRefreshError?: string | null;
  },
): LinkedStatus | null {
  const source = linkedSourceOf(row);
  if (!source) return null;
  if (source !== "plaid") {
    return { source, syncedAt: row.lastSyncedAt?.toISOString() ?? null, issue: null };
  }
  return {
    source,
    syncedAt: row.plaidRefreshedAt?.toISOString() ?? null,
    // Only the codes the client can fix — a product-config code is stored on
    // the item while its balances keep refreshing.
    issue: plaidIssueOf(row.plaidRefreshError ?? null),
  };
}

/** The hover text, one fact per line. `formatTime` renders the ISO time in the
 *  viewer's zone; without it (the server render) the time line is left out
 *  rather than printed in the server's zone. */
export function linkedStatusLines(status: LinkedStatus, formatTime?: (iso: string) => string): string[] {
  const lines = [linkedSourceLabel(status.source)];
  if (status.syncedAt == null) lines.push("Not synced yet");
  else if (formatTime) lines.push(`Last updated ${formatTime(status.syncedAt)}`);
  if (status.issue) lines.push(LINKED_ISSUE_TEXT[status.issue]);
  return lines;
}
