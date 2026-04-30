import { and, eq } from "drizzle-orm";

import { clients } from "@/db/schema";

import type { ImportPayload } from "../types";
import { emptyResult, type CommitContext, type CommitResult, type Tx } from "./types";

/**
 * Commits the primary + spouse identity slots into the `clients` table.
 * Single-row PATCH — there's no match logic because a household has
 * exactly one clients row.
 *
 * Strategy:
 *   firstName / lastName / dateOfBirth / filingStatus  → replace-if-non-null
 *   spouseName / spouseLastName / spouseDob            → replace-if-non-null
 *
 * "Empty" = undefined or null. The clients row is required (created at
 * client onboarding); commit just enriches the row with extracted fields.
 */
export async function commitClientsIdentity(
  tx: Tx,
  payload: ImportPayload,
  ctx: CommitContext,
): Promise<CommitResult> {
  const result = emptyResult();

  const updates: Record<string, unknown> = {};
  const { primary, spouse } = payload;

  if (primary?.firstName) updates.firstName = primary.firstName;
  if (primary?.lastName) updates.lastName = primary.lastName;
  if (primary?.dateOfBirth) updates.dateOfBirth = primary.dateOfBirth;
  if (primary?.filingStatus) updates.filingStatus = primary.filingStatus;

  if (spouse?.firstName) updates.spouseName = spouse.firstName;
  if (spouse?.lastName) updates.spouseLastName = spouse.lastName;
  if (spouse?.dateOfBirth) updates.spouseDob = spouse.dateOfBirth;

  if (Object.keys(updates).length === 0) {
    result.skipped = 1;
    return result;
  }

  updates.updatedAt = new Date();


  const updated = await tx
    .update(clients)
    .set(updates)
    .where(and(eq(clients.id, ctx.clientId), eq(clients.firmId, ctx.orgId)))
    .returning({ id: clients.id });

  if (updated.length === 1) {
    result.updated = 1;
  } else {
    result.skipped = 1;
  }
  return result;
}
