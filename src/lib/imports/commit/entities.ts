import { and, eq, sql } from "drizzle-orm";

import { entities, revocableTrusts } from "@/db/schema";
import { deriveIsIrrevocable } from "@/lib/entities/trust";

import { getExistingId, linkCreated, type ImportPayload } from "../types";
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
 * not produce the trust-detail fields), so a new trust takes the trust
 * form's own new-trust defaults — an irrevocable trust with no grantor —
 * and the advisor refines it in the canonical entity editor post-commit.
 *
 * A living / revocable trust is not an entity in this app: it becomes a
 * revocable-trust tag (`revocable_trusts`), whose assets stay in the estate.
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
      const entityType = row.entityType ?? "trust";

      if (entityType === "trust" && isRevocableTrustName(row.name)) {
        // Not linked back onto the row: the id is a tag's, not an entity's.
        // A re-commit finds the tag by name instead.
        const [existing] = await tx
          .select({ id: revocableTrusts.id })
          .from(revocableTrusts)
          .where(
            and(
              eq(revocableTrusts.clientId, ctx.clientId),
              sql`lower(trim(${revocableTrusts.name})) = ${row.name.trim().toLowerCase()}`,
            ),
          );
        if (existing) {
          result.skipped += 1;
          continue;
        }
        await tx.insert(revocableTrusts).values({ clientId: ctx.clientId, name: row.name });
        result.created += 1;
        continue;
      }

      const [inserted] = await tx.insert(entities).values({
        clientId: ctx.clientId,
        name: row.name,
        entityType,
        ...(entityType === "trust" && {
          trustSubType: "irrevocable" as const,
          isIrrevocable: deriveIsIrrevocable("irrevocable"),
        }),
      }).returning({ id: entities.id });
      linkCreated(row, inserted.id);
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

/** "… Living Trust" or "… Revocable Trust" — but not "Irrevocable". */
function isRevocableTrustName(name: string): boolean {
  return /\b(living trust|revocable)\b/i.test(name) && !/\birrevocable\b/i.test(name);
}
