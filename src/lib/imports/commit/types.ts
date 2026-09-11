import type { db } from "@/db";
import type { ClientMilestones } from "@/lib/milestones";

/** Inferred from `db.transaction` callback to avoid coupling to internal Drizzle generics. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The set of tab identifiers used by the import wizard. Each maps to one
 * commit module. Order in the union is the canonical apply order when the
 * route handler commits multiple tabs in a single request — plan-basics
 * first (it writes the client row and nothing depends on it), then
 * clients-identity (so family-members can read primary/spouse names), then
 * family-members (so accounts/etc. can resolve owner -> family member id),
 * then everything else. `savings` resolves its destination account BY NAME
 * against already-committed accounts (mirroring `goals`' funding-account
 * resolution), so it must run after `accounts`. `goals` is LAST: it resolves
 * its funding accounts and its student by querying rows the `accounts` and
 * `family-members` tabs have already written, so it must never run before
 * them.
 */
export const COMMIT_TABS = [
  "plan-basics",
  "clients-identity",
  "family-members",
  "accounts",
  "incomes",
  "expenses",
  "liabilities",
  "life-insurance",
  "wills",
  "entities",
  "savings",
  "goals",
] as const;

export type CommitTab = (typeof COMMIT_TABS)[number];

export interface CommitResult {
  created: number;
  updated: number;
  skipped: number;
  warnings: string[];
}

export function emptyResult(): CommitResult {
  return { created: 0, updated: 0, skipped: 0, warnings: [] };
}

export interface CommitContext {
  clientId: string;
  scenarioId: string;
  orgId: string;
  userId: string;
  /** Resolved client milestones, for translating year-ref timing on incomes/expenses. */
  milestones?: ClientMilestones;
  /** Pre-resolved ticker classifications/prices (Phase A). */
  resolvedHoldings?: ResolvedHoldingsMap;
  /** Sink: account ids that received holdings, for post-commit asset-mix sync. */
  holdingsAccountIds?: string[];
  /**
   * Restricts a commit to specific payload rows, keyed by `Annotated.__rowId`
   * (Task 6). Absent = commit everything, which is the import wizard's
   * existing behaviour and must stay byte-for-byte unchanged. Present = only
   * rows whose `__rowId` is listed commit; a row carrying no `__rowId` never
   * matches, which is the fail-closed direction for rows assembled before
   * Task 6 started assigning ids.
   *
   * This field lives on the shared `CommitContext`, so it is visible to all
   * twelve `COMMIT_TABS` — but today only `commitAccounts` honours it. Every
   * other tab ignores it and commits its section unfiltered, so the chat
   * surface (the only caller that sets this) must always pair `rowIds` with
   * `tabs: ["accounts"]`; pairing it with a second tab commits that tab's
   * rows unfiltered. Phase 2 widens `rowIds` support to more entity types.
   *
   * Residual from Task 6: a row whose dedupe key was null gets an id keyed by
   * its position, so it is deterministic but not stable across a
   * re-extraction that removes an earlier row in the same file.
   */
  rowIds?: readonly string[];
}

/** A ticker resolved to a security + (optional) live price during commit. */
export interface ResolvedTicker {
  securityId: string;
  price: number | null;
  asOf: string | null;
}

/** Upper-cased ticker -> resolution. Absent ticker = classification failed -> manual. */
export type ResolvedHoldingsMap = Map<string, ResolvedTicker>;
