// src/lib/fact-finder/save/writers/liabilities.ts
/**
 * The liability save writer: the Details write path (liabilities-writes.ts) on
 * the save's transaction. The line's owners go through as the line says them;
 * the debt type — which neither Details route writes — is checked before the
 * core call and set after it, on create and update.
 */
import { and, eq } from "drizzle-orm";
import { liabilities, liabilityTypeEnum } from "@/db/schema";
import { createLiabilityForClient, updateLiabilityForClient } from "@/lib/clients/liabilities-writes";
import { SaveLineError, unwrap, type SaveContext, type SaveInput, type SaveWriter } from "../types";

type LiabilityType = (typeof liabilityTypeEnum.enumValues)[number];

/** The line's debt type, else undefined when it carries none; one the plan can't save is refused before any write. */
function liabilityTypeOf(input: SaveInput): LiabilityType | undefined {
  const type = input.values.liabilityType;
  if (type === undefined) return undefined;
  if (!liabilityTypeEnum.enumValues.includes(type as LiabilityType)) throw new SaveLineError("The loan type isn't one the plan can save.");
  return type as LiabilityType;
}

async function writeLiabilityType(ctx: SaveContext, liabilityId: string, type: LiabilityType | undefined): Promise<void> {
  if (type === undefined) return;
  await ctx.tx
    .update(liabilities)
    .set({ liabilityType: type })
    .where(and(eq(liabilities.id, liabilityId), eq(liabilities.clientId, ctx.clientId)));
}

const liability: SaveWriter = {
  async create(ctx, input) {
    const type = liabilityTypeOf(input);
    const { resourceId } = unwrap(
      await createLiabilityForClient({
        clientId: ctx.clientId, firmId: ctx.firmId, actorId: ctx.actorId, input: input.body, tx: ctx.tx, afterCommit: ctx.afterCommit,
      }),
    );
    await writeLiabilityType(ctx, resourceId, type);
    return resourceId;
  },
  async update(ctx, input) {
    if (!input.recordId) throw new SaveLineError("The loan to change isn't on the plan.");
    const type = liabilityTypeOf(input);
    unwrap(
      await updateLiabilityForClient({
        clientId: ctx.clientId, firmId: ctx.firmId, actorId: ctx.actorId, liabilityId: input.recordId, input: input.body,
        tx: ctx.tx, afterCommit: ctx.afterCommit,
      }),
    );
    await writeLiabilityType(ctx, input.recordId, type);
  },
};

export const LIABILITY_WRITERS: { liability: SaveWriter } = { liability };
