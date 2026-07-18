import { db } from "@/db";
import { crmActivity, crmHouseholds } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

type RecordActivityInput = {
  householdId: string;
  kind:
    | "note" | "call" | "meeting" | "email" | "status_change"
    | "contact_change" | "account_change" | "document_uploaded" | "planning_link"
    | "relationship_change";
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  occurredAt: Date;
};

/**
 * Append a row to the per-household activity feed. Distinct from
 * `recordAudit` — audit is firm-wide SOC-2 evidence keyed by Clerk
 * userId; activity is a human-readable timeline of household events
 * surfaced in the CRM UI.
 */
export async function recordActivity(
  input: RecordActivityInput,
  opts: { actorUserId: string },
) {
  const household = await db.query.crmHouseholds.findFirst({
    where: eq(crmHouseholds.id, input.householdId),
    columns: { firmId: true },
  });
  if (!household) throw new Error(`Cannot record activity: household ${input.householdId} not found`);

  await db.insert(crmActivity).values({
    householdId: input.householdId,
    firmId: household.firmId,
    actorUserId: opts.actorUserId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    metadata: input.metadata,
    occurredAt: input.occurredAt,
  });
}

/**
 * `recordActivity` wrapped so a failure here never surfaces to the caller.
 * Callers use this post-commit, once the row(s) it's narrating are already
 * durable — letting an activity-log error propagate would report a false
 * failure for a write that actually succeeded, and on retry the caller could
 * immediately hit a unique-index guard and see a misleading "already exists"
 * error. Mirrors how `recordAudit` (src/lib/audit.ts) already swallows its
 * own failures and logs instead of throwing.
 *
 * `logTag` is caller-supplied (e.g. "household-relationships",
 * "promote-family-member") so a failure in production logs immediately
 * tells you which service emitted it.
 */
export async function recordActivityNonFatal(
  input: Parameters<typeof recordActivity>[0],
  opts: Parameters<typeof recordActivity>[1],
  logTag: string,
): Promise<void> {
  try {
    await recordActivity(input, opts);
  } catch (err) {
    const msg =
      err instanceof Error ? err.message.slice(0, 200) : "unknown activity error";
    console.error(`[${logTag}] failed to record:`, {
      kind: input.kind,
      householdId: input.householdId,
      err: msg,
    });
  }
}

export async function listActivity(householdId: string, opts?: { limit?: number; offset?: number }) {
  return db.query.crmActivity.findMany({
    where: eq(crmActivity.householdId, householdId),
    orderBy: [desc(crmActivity.occurredAt)],
    limit: opts?.limit ?? 50,
    offset: opts?.offset ?? 0,
  });
}
