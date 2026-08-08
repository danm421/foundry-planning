import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { createCrmHousehold, deleteCrmHousehold } from "@/lib/crm/households";
import { createCrmContact } from "@/lib/crm/contacts";
import type { CreateCrmContactInput, ImportHouseholdInput } from "@/lib/crm/schemas";

export type CommitRow = {
  household: ImportHouseholdInput;
  primary: CreateCrmContactInput;
  spouse?: CreateCrmContactInput;
};

export type ImportDecision =
  | { action: "create"; row: CommitRow }
  | { action: "skip"; row: CommitRow; matchedHouseholdId: string };

/**
 * Apply user-resolved decisions. Each `create` provisions a household, primary
 * contact, and optional spouse in dependency order; a failure isolates to one
 * row so a partial import still lands the rows that worked. `skip` is a no-op.
 *
 * The advisor id is taken from the session, never from the file — the import
 * template has no advisor column.
 */
export async function commit(
  decisions: ImportDecision[],
): Promise<{ created: number; skipped: number; errors: { rowIndex: number; messages: string[] }[] }> {
  const firmId = await requireOrgId();
  const { userId } = await auth();
  if (!userId) throw new Error("No signed-in user to assign imported households to");

  let created = 0;
  let skipped = 0;
  let orphansCleanedUp = 0;
  const errors: { rowIndex: number; messages: string[] }[] = [];

  for (let i = 0; i < decisions.length; i++) {
    const d = decisions[i];
    if (d.action === "skip") {
      skipped++;
      continue;
    }
    let householdId: string | null = null;
    try {
      const household = await createCrmHousehold({
        ...d.row.household,
        advisorId: userId,
      });
      householdId = household.id;
      await createCrmContact(household.id, d.row.primary);
      if (d.row.spouse) {
        await createCrmContact(household.id, d.row.spouse);
      }
      created++;
    } catch (err) {
      // If the household landed but a contact insert threw, roll the household
      // back rather than leave a contactless orphan. Swallow rollback failures
      // — the original error is the one worth surfacing.
      if (householdId) {
        try {
          await deleteCrmHousehold(householdId);
          orphansCleanedUp++;
        } catch {
          // best-effort cleanup; original error wins
        }
      }
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ rowIndex: i, messages: [msg] });
    }
  }

  await recordAudit({
    action: "crm.import.commit",
    resourceType: "crm_import",
    resourceId: `${firmId}:${Date.now()}`,
    firmId,
    metadata: {
      created,
      skipped,
      errorCount: errors.length,
      ...(orphansCleanedUp > 0 ? { orphansCleanedUp } : {}),
    },
  });

  return { created, skipped, errors };
}
