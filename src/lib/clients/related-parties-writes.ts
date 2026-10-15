// Related party write-core (trustees, executors, attorneys — `crm_household_contacts`
// rows with role "other"). The POST and PATCH route bodies, lifted verbatim so the
// fact finder save can write them on its transaction. The caller hands in the
// client's own CRM household id (`client.crmHouseholdId`) — never one from a body.
// Imports only what the route's test mocks provide (`@/db` insert/update, `@/lib/audit`'s
// recordAudit, `eq`/`and`): keep it that way.
import { crmHouseholdContacts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { handleOf, type WriteOptions } from "@/lib/db-tx";
import { summarizeZodIssues } from "@/lib/schemas/common";
import { relatedPartyCreateSchema, relatedPartyUpdateSchema } from "@/lib/schemas/related-parties";
import { writeError, type EntityWriteResult } from "./entity-write-result";

type ContactRow = typeof crmHouseholdContacts.$inferSelect;

export async function createRelatedPartyForClient(
  args: {
    clientId: string;
    firmId: string;
    /** Absent: the audit row names the signed-in user, as the route always has. */
    actorId?: string;
    householdId: string;
    input: unknown;
    crossFirmMeta?: Record<string, unknown>;
  } & WriteOptions,
): Promise<EntityWriteResult<ContactRow>> {
  const parsed = relatedPartyCreateSchema.safeParse(args.input);
  if (!parsed.success) return writeError(400, summarizeZodIssues(parsed.error));
  const {
    role, firstName, lastName, relationshipLabel,
    email, phone, mobile, employer, occupation, notes,
  } = parsed.data;

  const [contact] = await handleOf(args)
    .insert(crmHouseholdContacts)
    .values({
      // The PATH client's own household, never a `householdId` in the body —
      // that is the only thing standing between this write and a write into
      // another firm's household.
      householdId: args.householdId,
      // Fixed to "other" by the schema. `familyMemberId` is deliberately
      // never set: it is the key of a partial unique index, and a planning
      // link belongs to the `dependent` role, not to an external contact.
      role,
      firstName,
      lastName,
      relationshipLabel,
      email,
      phone,
      mobile,
      employer,
      occupation,
      notes,
    })
    .returning();

  await recordAudit({
    action: "related_party.create",
    resourceType: "crm_household_contact",
    resourceId: contact.id,
    clientId: args.clientId,
    firmId: args.firmId,
    actorId: args.actorId,
    metadata: {
      firstName: contact.firstName,
      lastName: contact.lastName,
      relationshipLabel: contact.relationshipLabel,
      ...args.crossFirmMeta,
    },
    tx: args.tx,
  });

  return { ok: true, data: contact, resourceId: contact.id };
}

export async function updateRelatedPartyForClient(
  args: {
    clientId: string;
    firmId: string;
    actorId?: string;
    householdId: string;
    partyId: string;
    input: unknown;
    crossFirmMeta?: Record<string, unknown>;
  } & WriteOptions,
): Promise<EntityWriteResult<ContactRow>> {
  const parsed = relatedPartyUpdateSchema.safeParse(args.input);
  if (!parsed.success) return writeError(400, summarizeZodIssues(parsed.error));

  // A body that asks for NOTHING is refused, not performed. Left to run, the
  // update would set only `updatedAt`, answer 200 and file a
  // `related_party.update` audit row for a change that never happened — and
  // `commitMapRow` reads any 2xx as a landed write, so the advisor's review
  // row would be stamped "committed" having written nothing.
  // 400 rather than 422: the repo already answers 400 for this case in
  // `portal/settings`, `portal/transactions/[id]` and the `toggle-groups` PATCH.
  if (Object.keys(parsed.data).length === 0) {
    return writeError(400, "PATCH body must include at least one field to update");
  }

  const [updated] = await handleOf(args)
    .update(crmHouseholdContacts)
    .set({ ...parsed.data, updatedAt: new Date() })
    // Three legs, and the last two are the ownership check. Without the
    // household leg a `partyId` from another firm's household is writable
    // through this client's id; without the role leg the household's own
    // primary or spouse is editable from here. Both are part of the
    // predicate rather than a prior SELECT, so there is no window between
    // the check and the write.
    .where(
      and(
        eq(crmHouseholdContacts.id, args.partyId),
        eq(crmHouseholdContacts.householdId, args.householdId),
        eq(crmHouseholdContacts.role, "other"),
      ),
    )
    .returning();

  if (!updated) {
    // Same predicate, same status — a better sentence, shown to the advisor by
    // `commitMapRow`. It names the likely reason without claiming it: the other
    // way to land here is a `partyId` from another household.
    return writeError(
      404,
      "Related party not found — the household's own contacts (the client, their co-client and any dependants) are edited on the Household screen, not here.",
    );
  }

  await recordAudit({
    action: "related_party.update",
    resourceType: "crm_household_contact",
    resourceId: args.partyId,
    clientId: args.clientId,
    firmId: args.firmId,
    actorId: args.actorId,
    metadata: {
      firstName: updated.firstName,
      lastName: updated.lastName,
      relationshipLabel: updated.relationshipLabel,
      ...args.crossFirmMeta,
    },
    tx: args.tx,
  });

  return { ok: true, data: updated, resourceId: updated.id };
}
