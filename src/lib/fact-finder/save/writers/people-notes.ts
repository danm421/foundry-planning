// src/lib/fact-finder/save/writers/people-notes.ts
/**
 * The charity, related-party and plan-note save writers: the Details write
 * paths (external-beneficiaries-, related-parties- and observations-writes.ts)
 * on the save's transaction. The one rule beyond them: a charity (or other
 * beneficiary) Create is refused when the plan already has one of that name,
 * or the save has just added one.
 */
import { eq, sql } from "drizzle-orm";
import { clients, externalBeneficiaries } from "@/db/schema";
import { createExternalBeneficiaryForClient, updateExternalBeneficiaryForClient } from "@/lib/clients/external-beneficiaries-writes";
import { createObservationForClient, updateObservationForClient } from "@/lib/clients/observations-writes";
import { createRelatedPartyForClient, updateRelatedPartyForClient } from "@/lib/clients/related-parties-writes";
import { coreArgs, recordIdOf, SaveLineError, unwrap, type SaveContext, type SaveWriter } from "../types";

const nameKey = (name: string) => name.trim().toLowerCase();

/** The client's own CRM household — read on the save's transaction, never taken from a line. */
async function householdOf(ctx: SaveContext): Promise<string> {
  const [row] = await ctx.tx.select({ householdId: clients.crmHouseholdId }).from(clients).where(eq(clients.id, ctx.clientId));
  if (!row) throw new SaveLineError("The client isn't on the plan.");
  return row.householdId;
}

const NO_RECORD = "The record to change isn't on the plan.";

/** What the change list calls the kind a new one is created as: a person is a beneficiary; no kind saves as a charity. */
const nounsOf = (kind: unknown) => (kind === "individual" ? { one: "beneficiary", many: "beneficiaries" } : { one: "charity", many: "charities" });

const external_beneficiary: SaveWriter = {
  async create(ctx, input) {
    const name = typeof input.body.name === "string" ? input.body.name.trim() : "";
    const onPlan = await ctx.tx
      .select({
        name: externalBeneficiaries.name,
        kind: externalBeneficiaries.kind,
        // now() is the save's transaction start, so this save's own Creates carry it as created_at (the column's default).
        addedBySave: sql<boolean>`${externalBeneficiaries.createdAt} = now()`,
      })
      .from(externalBeneficiaries)
      .where(eq(externalBeneficiaries.clientId, ctx.clientId));
    const same = name ? onPlan.filter((r) => nameKey(r.name) === nameKey(name)) : [];
    // The record on file is named by its own kind; two new rows in one save, by the new line's.
    const onRecord = same.find((r) => !r.addedBySave);
    if (onRecord) {
      throw new SaveLineError(`The plan already has a ${nounsOf(onRecord.kind).one} named “${name}” — link this row to it, or untick it.`);
    }
    if (same.length > 0) throw new SaveLineError(`Two ${nounsOf(input.body.kind).many} named “${name}” are being added — merge the rows, or untick one.`);
    return unwrap(await createExternalBeneficiaryForClient({ clientId: ctx.clientId, input: input.body, tx: ctx.tx, afterCommit: ctx.afterCommit })).resourceId;
  },
  async update(ctx, input) {
    unwrap(
      await updateExternalBeneficiaryForClient({
        clientId: ctx.clientId, beneficiaryId: recordIdOf(input, NO_RECORD), input: input.body, tx: ctx.tx, afterCommit: ctx.afterCommit,
      }),
    );
  },
};

const related_party: SaveWriter = {
  async create(ctx, input) {
    return unwrap(await createRelatedPartyForClient({ ...coreArgs(ctx), householdId: await householdOf(ctx), input: input.body })).resourceId;
  },
  async update(ctx, input) {
    unwrap(
      await updateRelatedPartyForClient({ ...coreArgs(ctx), householdId: await householdOf(ctx), partyId: recordIdOf(input, NO_RECORD), input: input.body }),
    );
  },
};

const plan_observation: SaveWriter = {
  async create(ctx, input) {
    return unwrap(await createObservationForClient({ ...coreArgs(ctx), input: input.body })).resourceId;
  },
  async update(ctx, input) {
    unwrap(await updateObservationForClient({ ...coreArgs(ctx), observationId: recordIdOf(input, NO_RECORD), input: input.body }));
  },
};

export const PEOPLE_NOTE_WRITERS: { external_beneficiary: SaveWriter; related_party: SaveWriter; plan_observation: SaveWriter } = {
  external_beneficiary,
  related_party,
  plan_observation,
};
