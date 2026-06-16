import { db } from "@/db";
import { crmActivity, crmHouseholds } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

type RecordActivityInput = {
  householdId: string;
  kind:
    | "note" | "call" | "meeting" | "email" | "status_change"
    | "contact_change" | "account_change" | "document_uploaded" | "planning_link";
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

export async function listActivity(householdId: string, opts?: { limit?: number; offset?: number }) {
  return db.query.crmActivity.findMany({
    where: eq(crmActivity.householdId, householdId),
    orderBy: [desc(crmActivity.occurredAt)],
    limit: opts?.limit ?? 50,
    offset: opts?.offset ?? 0,
  });
}
