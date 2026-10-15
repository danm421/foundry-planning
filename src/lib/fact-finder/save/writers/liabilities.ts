// src/lib/fact-finder/save/writers/liabilities.ts
/**
 * The liability save writer: the Details write path (liabilities-writes.ts) on
 * the save's transaction. The line's owners go through as the line says them;
 * the debt type — which neither Details route writes — is set here, after the
 * core call, on create and update.
 */
import { and, eq } from "drizzle-orm";
import { liabilities, liabilityTypeEnum } from "@/db/schema";
import { createLiabilityForClient, updateLiabilityForClient } from "@/lib/clients/liabilities-writes";
import { SaveLineError, unwrap, type SaveContext, type SaveInput, type SaveWriter } from "../types";

type LiabilityType = (typeof liabilityTypeEnum.enumValues)[number];

async function writeLiabilityType(ctx: SaveContext, liabilityId: string, input: SaveInput): Promise<void> {
  const type = input.values.liabilityType;
  if (type === undefined) return;
  if (!liabilityTypeEnum.enumValues.includes(type as LiabilityType)) throw new SaveLineError("The loan type isn't one the plan can save.");
  await ctx.tx
    .update(liabilities)
    .set({ liabilityType: type as LiabilityType })
    .where(and(eq(liabilities.id, liabilityId), eq(liabilities.clientId, ctx.clientId)));
}

const liability: SaveWriter = {
  async create(ctx, input) {
    const { resourceId } = unwrap(
      await createLiabilityForClient({
        clientId: ctx.clientId, firmId: ctx.firmId, actorId: ctx.actorId, input: input.body, tx: ctx.tx, afterCommit: ctx.afterCommit,
      }),
    );
    await writeLiabilityType(ctx, resourceId, input);
    return resourceId;
  },
  async update(ctx, input) {
    if (!input.recordId) throw new SaveLineError("The loan to change isn't on the plan.");
    unwrap(
      await updateLiabilityForClient({
        clientId: ctx.clientId, firmId: ctx.firmId, actorId: ctx.actorId, liabilityId: input.recordId, input: input.body,
        tx: ctx.tx, afterCommit: ctx.afterCommit,
      }),
    );
    await writeLiabilityType(ctx, input.recordId, input);
  },
};

export const LIABILITY_WRITERS: { liability: SaveWriter } = { liability };
