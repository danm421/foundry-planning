// src/lib/fact-finder/save/writers/life-insurance.ts
/**
 * The life insurance policy save writer (Plan 4, D4). A policy line's body goes
 * through the policy routes' write core on the save's transaction; then the
 * writer writes the two columns those routes don't take — the carrier and the
 * policy number's last 4 (their schemas strip them) — on the same transaction,
 * scoped by client. An update sends only the line's ticked keys, and a line
 * never carries a cash value schedule, so the schedule on record stays.
 *
 * A life insurance account can be on the plan without its details row (Data
 * Collection adds one bare). The core's PATCH writes the details to that row
 * and doesn't check it's there (nor does Details' own edit), so an update whose
 * ticked values go to it is refused instead of reported as saved.
 */
import { and, eq, inArray } from "drizzle-orm";
import { accounts, lifeInsurancePolicies } from "@/db/schema";
import { createInsurancePolicyForClient, updateInsurancePolicyForClient } from "@/lib/clients/insurance-policies-writes";
import type { ChangeLine, PlacedValue } from "../../change-set";
import { targetField } from "../../placement/targets";
import { SaveLineError, unwrap, type SaveContext, type SaveWriter } from "../types";

/** A policy line's keys that write its details row (life_insurance_policies): the core's, then the writer's own two. */
const DETAIL_KEYS = new Set([
  "faceValue", "costBasis", "premiumAmount", "premiumYears", "premiumPayer", "policyType", "termIssueYear", "termLengthYears", "endsAtInsuredRetirement",
  "carrier", "policyNumberLast4",
]);

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
    throw noDetailsRow(Object.keys(details).map((key) => `“${targetField("life_insurance_policy", key)?.label ?? key}”`));
  }
}

/** Ticked fields (their quoted labels) that go to a details row the policy doesn't have: what's true, and what works. */
function noDetailsRow(labels: readonly string[]): SaveLineError {
  const them = labels.length === 1 ? "it" : "them";
  const named = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return new SaveLineError(`This policy has no details on the plan, so ${named} can't be saved by an update — untick ${them} to save the rest.`);
}

/** Refuses an update whose ticked values go to a details row the client's policy doesn't have. */
async function needDetailsRow(ctx: SaveContext, policyId: string, line: ChangeLine, values: Record<string, PlacedValue>): Promise<void> {
  const labels = line.fields.filter((f) => DETAIL_KEYS.has(f.key) && f.key in values).map((f) => `“${f.label}”`);
  if (labels.length === 0) return;
  const [policy] = await ctx.tx
    .select({ details: lifeInsurancePolicies.accountId })
    .from(accounts)
    .leftJoin(lifeInsurancePolicies, eq(lifeInsurancePolicies.accountId, accounts.id))
    .where(and(eq(accounts.id, policyId), eq(accounts.clientId, ctx.clientId)));
  // No policy at all: the core answers "Policy not found".
  if (!policy || policy.details !== null) return;
  throw noDetailsRow(labels);
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
    async update(ctx, { line, values, body, recordId }) {
      if (!recordId) throw new SaveLineError("This line has no policy on the plan to update.");
      const details = policyDetails(values);
      await needDetailsRow(ctx, recordId, line, values);
      unwrap(await updateInsurancePolicyForClient({ ...coreArgs(ctx), policyId: recordId, input: coreInput(body) }));
      await writePolicyDetails(ctx, recordId, details);
    },
  },
};
