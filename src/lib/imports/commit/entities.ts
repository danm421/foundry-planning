import { and, eq } from "drizzle-orm";

import { entities } from "@/db/schema";

import { getExistingId, type ImportPayload } from "../types";
import { emptyResult, type CommitContext, type CommitResult, type Tx } from "./types";

/**
 * Commits the entities tab.
 *
 * Field map (per plan):
 *   name: keep-existing
 *   entityType: replace
 *   includeInPortfolio, isGrantor, value, owner, grantor,
 *   trustSubType, isIrrevocable, trustee: replace-if-non-null
 *
 * The extracted entity carries only `name` and `entityType` (the LLM does
 * not produce the trust-detail fields), so on insert the trust-only
 * columns are left null and the advisor fills them in via the canonical
 * entity editor post-commit.
 */
export async function commitEntities(
  tx: Tx,
  payload: ImportPayload,
  ctx: CommitContext,
): Promise<CommitResult> {
  const result = emptyResult();
  const now = new Date();

  for (const row of payload.entities) {
    const kind = row.match?.kind ?? "new";

    if (kind === "fuzzy") {
      result.skipped += 1;
      continue;
    }

    if (kind === "new") {
      await tx.insert(entities).values({
        clientId: ctx.clientId,
        name: row.name,
        entityType: row.entityType ?? "trust",
      });
      result.created += 1;
      continue;
    }

    const existingId = getExistingId(row);
    if (!existingId) {
      result.skipped += 1;
      continue;
    }
    const updates: Record<string, unknown> = { updatedAt: now };
    if (row.entityType !== undefined) updates.entityType = row.entityType;

    await tx
      .update(entities)
      .set(updates)
      .where(
        and(eq(entities.id, existingId), eq(entities.clientId, ctx.clientId)),
      );
    result.updated += 1;
  }

  return result;
}
