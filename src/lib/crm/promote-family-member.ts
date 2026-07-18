import { db } from "@/db";
import {
  clients,
  crmHouseholdContacts,
  crmHouseholdRelationships,
  crmHouseholds,
  familyMembers,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { requireCrmHouseholdAccess } from "./authz";
import { recordAudit } from "@/lib/audit";
import { recordActivityNonFatal } from "./activity";
import { buildHouseholdName } from "./household-name";
import { isUniqueViolation } from "./household-relationships";

export class FamilyMemberNotInHouseholdError extends Error {
  constructor() { super("Family member does not belong to this household"); }
}

export type PromoteFamilyMemberInput = {
  sourceFamilyMemberId?: string | null;
  firstName: string;
  lastName: string;
  dateOfBirth?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  state: string;
  status?: "prospect" | "active" | "inactive" | "archived";
};

/**
 * Promote a family member (or a prospect household's dependent) into their
 * own CRM household: household + seeded primary contact + canonical `child`
 * edge back to the source household, in one transaction. The source
 * `family_members` row is NEVER touched — beneficiary designations, will
 * recipients, and estate flow reference it.
 *
 * Direct inserts (not createCrmHousehold) because that service opens its own
 * transaction and can't join this one; atomicity across household + contact
 * + edge wins over reuse. Audit/activity are written after commit, mirroring
 * createCrmHousehold (they don't accept a tx handle).
 */
export async function promoteFamilyMember(
  sourceHouseholdId: string,
  input: PromoteFamilyMemberInput,
): Promise<{ householdId: string; existing: boolean }> {
  const { household: sourceHousehold, orgId } = await requireCrmHouseholdAccess(sourceHouseholdId);
  const { userId } = await auth();
  const actorId = userId ?? "system";

  if (input.sourceFamilyMemberId) {
    // Never trust client-supplied linkage: the family member must belong to
    // the source household's planning client.
    const planningClient = await db.query.clients.findFirst({
      where: eq(clients.crmHouseholdId, sourceHouseholdId),
      columns: { id: true },
    });
    const member = planningClient
      ? await db.query.familyMembers.findFirst({
          where: and(
            eq(familyMembers.id, input.sourceFamilyMemberId),
            eq(familyMembers.clientId, planningClient.id),
          ),
          columns: { id: true },
        })
      : null;
    if (!member) throw new FamilyMemberNotInHouseholdError();

    // Already promoted → hand back the existing household (idempotent).
    const existingEdge = await db.query.crmHouseholdRelationships.findFirst({
      where: eq(crmHouseholdRelationships.sourceFamilyMemberId, input.sourceFamilyMemberId),
    });
    if (existingEdge) return { householdId: existingEdge.fromHouseholdId, existing: true };
  }

  // Scoped to exactly db.transaction(...) — the catch below means one thing
  // only: the transaction lost the unique-index race. Post-commit
  // recordAudit/recordActivityNonFatal calls never throw (they swallow their
  // own failures), so keeping them out of this try prevents a future
  // throwing call from being misrouted through isUniqueViolation(err) =>
  // false => a false failure report for a promote that already committed.
  let result: { household: typeof crmHouseholds.$inferSelect; contact: typeof crmHouseholdContacts.$inferSelect; edge: typeof crmHouseholdRelationships.$inferSelect };
  try {
    result = await db.transaction(async (tx) => {
      const [household] = await tx
        .insert(crmHouseholds)
        .values({
          firmId: orgId,
          advisorId: actorId,
          name: buildHouseholdName({ firstName: input.firstName, lastName: input.lastName }),
          status: input.status ?? "prospect",
          state: input.state,
        })
        .returning();
      const [contact] = await tx
        .insert(crmHouseholdContacts)
        .values({
          householdId: household.id,
          role: "primary",
          firstName: input.firstName,
          lastName: input.lastName,
          dateOfBirth: input.dateOfBirth ?? null,
          email: input.email || null,
          phone: input.phone || null,
          mobile: input.mobile || null,
          // Mirror createCrmHousehold: seed the primary's address state from
          // the household residence.
          state: input.state,
        })
        .returning();
      const [edge] = await tx
        .insert(crmHouseholdRelationships)
        .values({
          firmId: orgId,
          // Canonical: `from` is the child of `to`.
          fromHouseholdId: household.id,
          toHouseholdId: sourceHouseholdId,
          relationshipType: "child",
          sourceFamilyMemberId: input.sourceFamilyMemberId ?? null,
          createdBy: actorId,
        })
        .returning();
      return { household, contact, edge };
    });
  } catch (err) {
    // Double-promote race: the partial unique on source_family_member_id won
    // and the whole transaction rolled back — return the winner's household.
    if (input.sourceFamilyMemberId && isUniqueViolation(err)) {
      const winner = await db.query.crmHouseholdRelationships.findFirst({
        where: eq(crmHouseholdRelationships.sourceFamilyMemberId, input.sourceFamilyMemberId),
      });
      if (winner) return { householdId: winner.fromHouseholdId, existing: true };
    }
    throw err;
  }

  await recordAudit({ action: "crm.household.create", resourceType: "crm_household", resourceId: result.household.id, firmId: orgId });
  await recordAudit({ action: "crm.contact.create", resourceType: "crm_contact", resourceId: result.contact.id, firmId: orgId });
  await recordAudit({ action: "crm.household_relationship.create", resourceType: "crm_household_relationship", resourceId: result.edge.id, firmId: orgId });
  const now = new Date();
  await recordActivityNonFatal(
    {
      householdId: sourceHouseholdId,
      kind: "relationship_change",
      title: `Promoted ${input.firstName} ${input.lastName} to their own household`,
      metadata: { newHouseholdId: result.household.id, relationshipId: result.edge.id },
      occurredAt: now,
    },
    { actorUserId: actorId },
    "promote-family-member",
  );
  await recordActivityNonFatal(
    {
      householdId: result.household.id,
      kind: "relationship_change",
      title: `Created by promotion from ${sourceHousehold.name}`,
      metadata: { sourceHouseholdId, relationshipId: result.edge.id },
      occurredAt: now,
    },
    { actorUserId: actorId },
    "promote-family-member",
  );
  return { householdId: result.household.id, existing: false };
}
