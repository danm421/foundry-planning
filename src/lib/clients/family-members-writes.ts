// src/lib/clients/family-members-writes.ts
//
// Family-member create core, shared by POST /api/clients/[id]/family-members
// and the Forge's add_family_member tool so route and agent can never drift.
import { db } from "@/db";
import { familyMembers } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { verifyClientAccess } from "@/lib/clients/authz";
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
}): Promise<EntityWriteResult<FamilyMemberRow>> {
  const { clientId, firmId, actorId, input, crossFirmMeta } = args;

  const a = await verifyClientAccess(clientId);
  if (!a.ok || a.firmId !== firmId) return writeError(404, "Client not found");

  const parsed = familyMemberCreateSchema.safeParse(input);
  if (!parsed.success) return writeError(400, summarizeZodIssues(parsed.error));
  const {
    firstName, lastName, relationship, dateOfBirth, notes,
    domesticPartner, inheritanceClassOverride,
  } = parsed.data;

  const [member] = await db
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
  });

  return { ok: true, data: member, resourceId: member.id };
}
