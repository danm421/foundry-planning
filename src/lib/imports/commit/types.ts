import type { db } from "@/db";

/** Inferred from `db.transaction` callback to avoid coupling to internal Drizzle generics. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The set of tab identifiers used by the import wizard. Each maps to one
 * commit module. Order in the union is the canonical apply order when the
 * route handler commits multiple tabs in a single request — clients-identity
 * first (so family-members can read primary/spouse names), then family-members
 * (so accounts/etc. can resolve owner -> family member id), then everything
 * else.
 */
export const COMMIT_TABS = [
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
}

export function emptyResult(): CommitResult {
  return { created: 0, updated: 0, skipped: 0 };
}

export interface CommitContext {
  clientId: string;
  scenarioId: string;
  orgId: string;
  userId: string;
}
