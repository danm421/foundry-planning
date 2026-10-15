// src/lib/fact-finder/save/writers/life-insurance.ts
/**
 * The life insurance policy save writer (Plan 4, D4). A policy line's body goes
 * through the policy routes' write core on the save's transaction; then the
 * writer writes the two columns those routes don't take — the carrier and the
 * policy number's last 4 (their schemas strip them) — on the same transaction,
 * scoped by client. An update sends only the line's ticked keys, and a line
 * never carries a cash value schedule, so the schedule on record stays.
 */
import { and, eq, inArray } from "drizzle-orm";
import { accounts, lifeInsurancePolicies } from "@/db/schema";
import { createInsurancePolicyForClient, updateInsurancePolicyForClient } from "@/lib/clients/insurance-policies-writes";
import type { PlacedValue } from "../../change-set";
import { SaveLineError, unwrap, type SaveContext, type SaveWriter } from "../types";

interface PolicyDetails {
  carrier?: string;
  policyNumberLast4?: string;
}

/** The line's carrier and last 4, checked here: the review's schema check never saw them (the routes' schemas drop them). */
function policyDetails(values: Record<string, PlacedValue>): PolicyDetails {
  const details: PolicyDetails = {};
  if (values.carrier !== undefined) {
    const carrier = typeof values.carrier === "string" ? values.carrier.trim() : "";
    if (carrier === "" || carrier.length > 200) throw new SaveLineError("Carrier: a name of up to 200 characters.");
    details.carrier = carrier;
  }
  if (values.policyNumberLast4 !== undefined) {
    const last4 = values.policyNumberLast4;
    if (typeof last4 !== "string" || !/^\d{4}$/.test(last4)) {
      throw new SaveLineError("Policy # (last 4): the policy number's last four digits.");
    }
    details.policyNumberLast4 = last4;
  }
  return details;
}

/** The Details request body without the two keys the routes don't take. */
function coreInput(body: Record<string, unknown>): Record<string, unknown> {
  const input = { ...body };
  delete input.carrier;
  delete input.policyNumberLast4;
  return input;
}

async function writePolicyDetails(ctx: SaveContext, policyId: string, details: PolicyDetails): Promise<void> {
  if (Object.keys(details).length === 0) return;
  const written = await ctx.tx
    .update(lifeInsurancePolicies)
    .set({ ...details, updatedAt: new Date() })
    .where(
      and(
        eq(lifeInsurancePolicies.accountId, policyId),
        inArray(lifeInsurancePolicies.accountId, ctx.tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.clientId, ctx.clientId))),
      ),
    )
    .returning({ id: lifeInsurancePolicies.accountId });
  if (written.length === 0) {
    throw new SaveLineError("This policy's details are missing on the plan, so its carrier and policy number can't be saved — untick them to save the rest.");
  }
}

const coreArgs = (ctx: SaveContext) => ({
  clientId: ctx.clientId,
  firmId: ctx.firmId,
  actorId: ctx.actorId,
  tx: ctx.tx,
  afterCommit: ctx.afterCommit,
});

export const LIFE_WRITERS: { life_insurance_policy: SaveWriter } = {
  life_insurance_policy: {
    async create(ctx, { values, body }) {
      const details = policyDetails(values);
      const { resourceId } = unwrap(await createInsurancePolicyForClient({ ...coreArgs(ctx), input: coreInput(body) }));
      await writePolicyDetails(ctx, resourceId, details);
      return resourceId;
    },
    async update(ctx, { values, body, recordId }) {
      if (!recordId) throw new SaveLineError("This line has no policy on the plan to update.");
      const details = policyDetails(values);
      unwrap(await updateInsurancePolicyForClient({ ...coreArgs(ctx), policyId: recordId, input: coreInput(body) }));
      await writePolicyDetails(ctx, recordId, details);
    },
  },
};
