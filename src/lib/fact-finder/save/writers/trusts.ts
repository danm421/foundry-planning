// src/lib/fact-finder/save/writers/trusts.ts
/**
 * The save's writers for the Trusts section (Plan 4, D4): an irrevocable trust
 * through the entities core (a new one gets its default cash account, as from
 * the Details page) and a revocable living trust through its own core.
 */
import { and, eq } from "drizzle-orm";
import { accounts } from "@/db/schema";
import { createEntityForClient, updateEntityForClient } from "@/lib/clients/entities-writes";
import { createRevocableTrustForClient, updateRevocableTrustForClient } from "@/lib/clients/revocable-trusts-writes";
import { unwrap, type SaveContext, type SaveInput, type SaveWriter } from "../types";

/** Who and where every core call of the save writes. */
function writeAs(ctx: SaveContext) {
  return { clientId: ctx.clientId, firmId: ctx.firmId, actorId: ctx.actorId, tx: ctx.tx, afterCommit: ctx.afterCommit };
}

function recordOf(input: SaveInput): string {
  if (!input.recordId) throw new Error(`${input.line.id}: an update line has no record`);
  return input.recordId;
}

/** The accounts a revocable trust holds now, read on the save's transaction. */
async function heldAccountIds(ctx: SaveContext, trustId: string): Promise<string[]> {
  const rows = await ctx.tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.clientId, ctx.clientId), eq(accounts.revocableTrustId, trustId)));
  return rows.map((r) => r.id);
}

export const TRUST_WRITERS: { entity: SaveWriter; revocable_trust: SaveWriter } = {
  entity: {
    async create(ctx, { body }) {
      return unwrap(await createEntityForClient({ ...writeAs(ctx), input: body })).resourceId;
    },
    async update(ctx, input) {
      unwrap(await updateEntityForClient({ ...writeAs(ctx), entityId: recordOf(input), input: input.body }));
    },
  },
  revocable_trust: {
    async create(ctx, { body }) {
      return unwrap(await createRevocableTrustForClient({ ...writeAs(ctx), input: body })).resourceId;
    },
    // A line carries the name only; the PATCH untags every account its body doesn't list.
    async update(ctx, input) {
      const trustId = recordOf(input);
      const body = { accountIds: await heldAccountIds(ctx, trustId), ...input.body };
      unwrap(await updateRevocableTrustForClient({ ...writeAs(ctx), trustId, input: body }));
    },
  },
};
