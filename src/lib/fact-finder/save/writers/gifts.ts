// src/lib/fact-finder/save/writers/gifts.ts
/**
 * The prior gift save writer: the Details write path (gifts-writes.ts) on the
 * save's transaction. Every prior gift saves as a cash gift of its amount (the
 * asset itself is never moved), so the asset-transfer path is never reached.
 */
import { createGiftForClient, updateGiftForClient } from "@/lib/clients/gifts-writes";
import { SaveLineError, unwrap, type SaveWriter } from "../types";

const gift: SaveWriter = {
  async create(ctx, input) {
    const { resourceId } = unwrap(
      await createGiftForClient({
        clientId: ctx.clientId, firmId: ctx.firmId, actorId: ctx.actorId, input: input.body, tx: ctx.tx, afterCommit: ctx.afterCommit,
      }),
    );
    return resourceId;
  },
  async update(ctx, input) {
    if (!input.recordId) throw new SaveLineError("The gift to change isn't on the plan.");
    unwrap(
      await updateGiftForClient({
        clientId: ctx.clientId, firmId: ctx.firmId, actorId: ctx.actorId, giftId: input.recordId, input: input.body,
        tx: ctx.tx, afterCommit: ctx.afterCommit,
      }),
    );
  },
};

export const GIFT_WRITERS: { gift: SaveWriter } = { gift };
