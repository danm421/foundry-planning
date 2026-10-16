// src/lib/fact-finder/save/writers/people-notes.ts
/**
 * The charity, related-party and plan-note save writers: the Details write
 * paths (external-beneficiaries-, related-parties- and observations-writes.ts)
 * on the save's transaction. The one rule beyond them: a charity Create is
 * refused when the plan already has a charity of that name.
 */
import { eq } from "drizzle-orm";
import { clients, externalBeneficiaries } from "@/db/schema";
import { createExternalBeneficiaryForClient, updateExternalBeneficiaryForClient } from "@/lib/clients/external-beneficiaries-writes";
import { createObservationForClient, updateObservationForClient } from "@/lib/clients/observations-writes";
import { createRelatedPartyForClient, updateRelatedPartyForClient } from "@/lib/clients/related-parties-writes";
import { SaveLineError, unwrap, type SaveContext, type SaveWriter } from "../types";

const nameKey = (name: string) => name.trim().toLowerCase();

/** The client's own CRM household — read on the save's transaction, never taken from a line. */
async function householdOf(ctx: SaveContext): Promise<string> {
  const [row] = await ctx.tx.select({ householdId: clients.crmHouseholdId }).from(clients).where(eq(clients.id, ctx.clientId));
  if (!row) throw new SaveLineError("The client isn't on the plan.");
  return row.householdId;
}

function needRecord(recordId: string | null): string {
  if (!recordId) throw new SaveLineError("The record to change isn't on the plan.");
  return recordId;
}

const external_beneficiary: SaveWriter = {
  async create(ctx, input) {
    const name = typeof input.body.name === "string" ? input.body.name.trim() : "";
    const onPlan = await ctx.tx.select({ name: externalBeneficiaries.name }).from(externalBeneficiaries).where(eq(externalBeneficiaries.clientId, ctx.clientId));
    if (name && onPlan.some((r) => nameKey(r.name) === nameKey(name))) {
      throw new SaveLineError(`The plan already has a charity named “${name}” — link this row to it, or untick it.`);
    }
    return unwrap(await createExternalBeneficiaryForClient({ clientId: ctx.clientId, input: input.body, tx: ctx.tx, afterCommit: ctx.afterCommit })).resourceId;
  },
  async update(ctx, input) {
    unwrap(
      await updateExternalBeneficiaryForClient({
        clientId: ctx.clientId, beneficiaryId: needRecord(input.recordId), input: input.body, tx: ctx.tx, afterCommit: ctx.afterCommit,
      }),
    );
  },
};

const related_party: SaveWriter = {
  async create(ctx, input) {
    return unwrap(
      await createRelatedPartyForClient({
        clientId: ctx.clientId, firmId: ctx.firmId, actorId: ctx.actorId, householdId: await householdOf(ctx),
        input: input.body, tx: ctx.tx, afterCommit: ctx.afterCommit,
      }),
    ).resourceId;
  },
  async update(ctx, input) {
    unwrap(
      await updateRelatedPartyForClient({
        clientId: ctx.clientId, firmId: ctx.firmId, actorId: ctx.actorId, householdId: await householdOf(ctx),
        partyId: needRecord(input.recordId), input: input.body, tx: ctx.tx, afterCommit: ctx.afterCommit,
      }),
    );
  },
};

const plan_observation: SaveWriter = {
  async create(ctx, input) {
    return unwrap(
      await createObservationForClient({
        clientId: ctx.clientId, firmId: ctx.firmId, actorId: ctx.actorId, input: input.body, tx: ctx.tx, afterCommit: ctx.afterCommit,
      }),
    ).resourceId;
  },
  async update(ctx, input) {
    unwrap(
      await updateObservationForClient({
        clientId: ctx.clientId, firmId: ctx.firmId, actorId: ctx.actorId, observationId: needRecord(input.recordId),
        input: input.body, tx: ctx.tx, afterCommit: ctx.afterCommit,
      }),
    );
  },
};

export const PEOPLE_NOTE_WRITERS: { external_beneficiary: SaveWriter; related_party: SaveWriter; plan_observation: SaveWriter } = {
  external_beneficiary,
  related_party,
  plan_observation,
};
