import { and, eq } from "drizzle-orm";

import { familyMembers } from "@/db/schema";

import { getExistingId, type ImportPayload } from "../types";
import { emptyResult, type CommitContext, type CommitResult, type Tx } from "./types";

/**
 * Commits the family-members tab. Three sub-flows in one pass:
 *
 *  1. role='client' singleton — upserted from `payload.primary` (no match
 *     annotation; one row per household, defined by role).
 *  2. role='spouse' singleton — upserted from `payload.spouse`.
 *  3. dependents[] — insert (kind='new') or update (kind='exact') keyed
 *     by the match annotation.
 *
 * Counts:
 *   created = newly-inserted rows (across all three sub-flows)
 *   updated = updated rows
 *   skipped = rows we couldn't apply (fuzzy without resolution)
 *
 * Field map (dependents):
 *   firstName, lastName: replace-if-non-null
 *   dateOfBirth: replace-if-non-null
 *   relationship, role: replace
 *   notes: keep-existing
 *
 * The primary/spouse singletons follow the same field-map for the fields
 * each shape carries (filingStatus is on the clients table, not here).
 */
export async function commitFamilyMembers(
  tx: Tx,
  payload: ImportPayload,
  ctx: CommitContext,
): Promise<CommitResult> {
  const result = emptyResult();

  if (payload.primary) {
    await upsertRoleSingleton(tx, ctx.clientId, "client", {
      firstName: payload.primary.firstName,
      lastName: payload.primary.lastName,
      dateOfBirth: payload.primary.dateOfBirth,
    }, result);
  }

  if (payload.spouse) {
    await upsertRoleSingleton(tx, ctx.clientId, "spouse", {
      firstName: payload.spouse.firstName,
      lastName: payload.spouse.lastName,
      dateOfBirth: payload.spouse.dateOfBirth,
    }, result);
  }

  for (const dep of payload.dependents) {
    const kind = dep.match?.kind ?? "new";
    if (kind === "fuzzy") {
      result.skipped += 1;
      continue;
    }

    const values = {
      firstName: dep.firstName,
      lastName: dep.lastName ?? null,
      dateOfBirth: dep.dateOfBirth ?? null,
      relationship: dep.relationship ?? "child",
      role: dep.role ?? "other",
    } as const;

    if (kind === "new") {
      await tx.insert(familyMembers).values({
        clientId: ctx.clientId,
        ...values,
      });
      result.created += 1;
    } else {
      // exact — update preserving notes (keep-existing) and skipping null-y fields
      const updates: Record<string, unknown> = {
        relationship: values.relationship,
        role: values.role,
        updatedAt: new Date(),
      };
      if (values.firstName) updates.firstName = values.firstName;
      if (values.lastName) updates.lastName = values.lastName;
      if (values.dateOfBirth) updates.dateOfBirth = values.dateOfBirth;
      const existingId = getExistingId(dep);
      if (!existingId) {
        result.skipped += 1;
        continue;
      }
      await tx
        .update(familyMembers)
        .set(updates)
        .where(
          and(
            eq(familyMembers.id, existingId),
            eq(familyMembers.clientId, ctx.clientId),
          ),
        );
      result.updated += 1;
    }
  }

  return result;
}

async function upsertRoleSingleton(
  tx: Tx,
  clientId: string,
  role: "client" | "spouse",
  fields: { firstName: string; lastName?: string; dateOfBirth?: string },
  result: CommitResult,
): Promise<void> {
  const [existing] = await tx
    .select({ id: familyMembers.id })
    .from(familyMembers)
    .where(and(eq(familyMembers.clientId, clientId), eq(familyMembers.role, role)));

  if (existing) {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (fields.firstName) updates.firstName = fields.firstName;
    if (fields.lastName) updates.lastName = fields.lastName;
    if (fields.dateOfBirth) updates.dateOfBirth = fields.dateOfBirth;
    await tx
      .update(familyMembers)
      .set(updates)
      .where(eq(familyMembers.id, existing.id));
    result.updated += 1;
  } else {
    await tx.insert(familyMembers).values({
      clientId,
      role,
      relationship: "other",
      firstName: fields.firstName,
      lastName: fields.lastName ?? null,
      dateOfBirth: fields.dateOfBirth ?? null,
    });
    result.created += 1;
  }
}
