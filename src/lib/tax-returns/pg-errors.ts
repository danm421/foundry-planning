/** Postgres undefined_table. */
const UNDEFINED_TABLE = "42P01";

/** Drizzle wraps every driver error in `DrizzleQueryError`, whose own `.code`
 *  is undefined — the Postgres code lives on `.cause`. Same unwrap as
 *  `isUniqueViolation` in `lib/crm/household-relationships.ts`; checking only
 *  `err.code` here would never match a real query failure, just the shape a
 *  test rejects with directly.
 *
 *  Shared by `assemble-analysis.ts` (the read path, degrading the documents
 *  panel to "unavailable") and `save-facts.ts` (the write path, falling back
 *  to the legacy direct `facts` write) — both need to recognize the same
 *  deploy-before-migrate window, before migration `0233` has run. */
export function isUndefinedTable(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  return e.code === UNDEFINED_TABLE || e.cause?.code === UNDEFINED_TABLE;
}
