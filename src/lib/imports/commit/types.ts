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
 * then everything else.
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
}

/** A ticker resolved to a security + (optional) live price during commit. */
export interface ResolvedTicker {
  securityId: string;
  price: number | null;
  asOf: string | null;
}

/** Upper-cased ticker -> resolution. Absent ticker = classification failed -> manual. */
export type ResolvedHoldingsMap = Map<string, ResolvedTicker>;
