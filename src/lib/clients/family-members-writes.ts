// src/lib/clients/family-members-writes.ts
//
// Family-member write cores: create, shared by POST /api/clients/[id]/family-members
// and the Forge's add_family_member tool so route and agent can never drift;
// update, moved from PUT /api/clients/[id]/family-members/[memberId] (the only
// writer of claimedAsDependent). With a caller's transaction (the fact finder
// save) the write and its audit run on it.
import { familyMembers, dependentOverrideEnum } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { verifyClientAccess } from "@/lib/clients/authz";
import { handleOf, type WriteOptions } from "@/lib/db-tx";
import { summarizeZodIssues } from "@/lib/schemas/common";
import { familyMemberCreateSchema } from "@/lib/schemas/family-members";
import { writeError, type EntityWriteResult } from "./entity-write-result";

type FamilyMemberRow = typeof familyMembers.$inferSelect;

export async function createFamilyMemberForClient(args: {
  clientId: string;
  firmId: string;
  /** Omitted by the route, so recordAudit resolves the session's actor itself
   *  — operator impersonation included — exactly as the route always did. */
  actorId?: string;
  input: unknown;
  crossFirmMeta?: Record<string, unknown>;
} & WriteOptions): Promise<EntityWriteResult<FamilyMemberRow>> {
  const { clientId, firmId, actorId, input, crossFirmMeta } = args;

  const a = await verifyClientAccess(clientId);
  if (!a.ok || a.firmId !== firmId) return writeError(404, "Client not found");

  const parsed = familyMemberCreateSchema.safeParse(input);
  if (!parsed.success) return writeError(400, summarizeZodIssues(parsed.error));
  const {
    firstName, lastName, relationship, dateOfBirth, notes,
    domesticPartner, inheritanceClassOverride,
  } = parsed.data;

  const [member] = await handleOf(args)
    .insert(familyMembers)
    .values({
      clientId,
      firstName,
      lastName: lastName ?? null,
      relationship: relationship ?? "child",
      dateOfBirth: dateOfBirth || null,
      notes: notes ?? null,
      domesticPartner: !!domesticPartner,
      inheritanceClassOverride: inheritanceClassOverride ?? {},
    })
    .returning();

  await recordAudit({
    action: "family_member.create",
    resourceType: "family_member",
    resourceId: member.id,
    clientId,
    firmId,
    actorId,
    metadata: {
      firstName: member.firstName,
      relationship: member.relationship,
      ...(crossFirmMeta ?? {}),
    },
    tx: args.tx,
  });

  return { ok: true, data: member, resourceId: member.id };
}

/** The PUT body as the route reads it — no schema: each key it carries is written. */
type FamilyMemberPatch = {
  firstName?: string;
  lastName?: string | null;
  relationship?: FamilyMemberRow["relationship"];
  dateOfBirth?: string | null;
  notes?: string | null;
  domesticPartner?: unknown;
  inheritanceClassOverride?: FamilyMemberRow["inheritanceClassOverride"];
  claimedAsDependent?: FamilyMemberRow["claimedAsDependent"];
};

/** No access check — the caller's gate decides. The update is limited to `memberId` within `clientId`. */
export async function updateFamilyMemberForClient(args: {
  clientId: string;
  firmId: string;
  /** Omitted by the route, so recordAudit resolves the session's actor itself. */
  actorId?: string;
  memberId: string;
  input: unknown;
  crossFirmMeta?: Record<string, unknown>;
} & WriteOptions): Promise<EntityWriteResult<FamilyMemberRow>> {
  const { clientId, firmId, actorId, memberId, input, crossFirmMeta } = args;
  const {
    firstName, lastName, relationship, dateOfBirth, notes,
    domesticPartner, inheritanceClassOverride, claimedAsDependent,
  } = input as FamilyMemberPatch;

  if (claimedAsDependent !== undefined && !dependentOverrideEnum.enumValues.includes(claimedAsDependent)) {
    return writeError(400, "claimedAsDependent must be 'auto', 'yes', or 'no'");
  }

  const [updated] = await handleOf(args)
    .update(familyMembers)
    .set({
      ...(firstName !== undefined && { firstName }),
      ...(lastName !== undefined && { lastName: lastName ?? null }),
      ...(relationship !== undefined && { relationship }),
      ...(dateOfBirth !== undefined && { dateOfBirth: dateOfBirth || null }),
      ...(notes !== undefined && { notes: notes ?? null }),
      ...(domesticPartner !== undefined && { domesticPartner: !!domesticPartner }),
      ...(inheritanceClassOverride !== undefined && { inheritanceClassOverride }),
      ...(claimedAsDependent !== undefined && { claimedAsDependent }),
      updatedAt: new Date(),
    })
    .where(and(eq(familyMembers.id, memberId), eq(familyMembers.clientId, clientId)))
    .returning();

  if (!updated) return writeError(404, "Family member not found");

  await recordAudit({
    action: "family_member.update",
    resourceType: "family_member",
    resourceId: memberId,
    clientId,
    firmId,
    actorId,
    metadata: { firstName: updated.firstName, relationship: updated.relationship, ...(crossFirmMeta ?? {}) },
    tx: args.tx,
  });

  return { ok: true, data: updated, resourceId: memberId };
}
