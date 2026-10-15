// src/lib/clients/ltc-policies-writes.ts
/**
 * Long-term care policy create and update — the write paths of
 * ltc-policies/route.ts (POST) and [policyId]/route.ts (PATCH), moved here so
 * the fact finder save can run them on its transaction. The routes keep their
 * gates and their responses. Client-level: tenancy lives in the query. The
 * rider check reads the life policy on the caller's transaction, so a rider on
 * a policy created earlier in the same save is checked against it.
 */
import { and, eq } from "drizzle-orm";
import { ltcPolicies, type LtcPolicyRow, type NewLtcPolicyRow } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { handleOf, type WriteOptions } from "@/lib/db-tx";
import { loadRiderLifePolicy, rowToLtcPolicy } from "@/lib/insurance-policies/load-ltc-policies";
import { normalizeLtcPolicyFields, type LtcPolicyFields } from "@/lib/insurance-policies/ltc-policy-fields";
import { ltcFieldsFromCreate, ltcFieldsToColumns } from "@/lib/insurance-policies/ltc-policy-row";
import { riderLinkProblem } from "@/lib/insurance-policies/ltc-rider-link";
import { formatZodIssues } from "@/lib/schemas/common";
import { LTC_POLICY_FIELD_KEYS, ltcPolicyCreateSchema, ltcPolicyProblems, ltcPolicyUpdateSchema } from "@/lib/schemas/ltc-policies";
import { writeError, type EntityWriteResult } from "./entity-write-result";

type PolicyArgs = {
  clientId: string;
  firmId: string;
  /** The route passes none (the audit row falls back to the session); the save passes the advisor. */
  actorId?: string;
  input: unknown;
  crossFirmMeta?: Record<string, unknown>;
} & WriteOptions;

export async function createLtcPolicyForClient(args: PolicyArgs): Promise<EntityWriteResult<LtcPolicyRow>> {
  const { clientId, firmId, actorId, input, crossFirmMeta } = args;
  const parsed = ltcPolicyCreateSchema.safeParse(input);
  if (!parsed.success) {
    const issues = formatZodIssues(parsed.error);
    return writeError(400, "Invalid body", { error: "Invalid body", issues });
  }
  const d = parsed.data;

  if (d.kind === "life_rider") {
    const problem = riderLinkProblem(d.insured, await loadRiderLifePolicy(clientId, d.lifePolicyAccountId!, args.tx));
    if (problem) return writeError(400, problem);
  }

  // Store the normalized row, so a write that did not come from the dialog
  // (Forge, the API) never keeps the other kind's leftovers or a schema
  // default that does not fit the kind.
  const fields = normalizeLtcPolicyFields(ltcFieldsFromCreate(d));
  const [row] = await handleOf(args)
    .insert(ltcPolicies)
    .values({ ...(ltcFieldsToColumns(fields) as NewLtcPolicyRow), clientId })
    .returning();

  await recordAudit({
    action: "ltc_policy.create",
    resourceType: "ltc_policy",
    resourceId: row.id,
    clientId,
    firmId,
    actorId,
    metadata: { name: fields.name, ...(crossFirmMeta ?? {}) },
    tx: args.tx,
  });

  return { ok: true, data: row, resourceId: row.id };
}

const scoped = (clientId: string, policyId: string) =>
  and(eq(ltcPolicies.id, policyId), eq(ltcPolicies.clientId, clientId));

/**
 * Validates the STORED ROW MERGED WITH THE BODY, not the body alone. A
 * body-only check (the disability route's) lets two one-key saves build a row
 * a create would refuse — e.g. `{kind:"life_rider"}` on a standalone policy.
 * Then it normalizes the merge and writes only the columns that differ from the
 * stored row: the sent keys that changed, plus the leftovers a kind switch cleared.
 */
export async function updateLtcPolicyForClient(
  args: PolicyArgs & { policyId: string },
): Promise<EntityWriteResult<LtcPolicyRow>> {
  const { clientId, firmId, actorId, policyId, input, crossFirmMeta } = args;
  const parsed = ltcPolicyUpdateSchema.safeParse(input);
  if (!parsed.success) {
    const issues = formatZodIssues(parsed.error);
    return writeError(400, "Invalid body", { error: "Invalid body", issues });
  }
  const d = parsed.data;
  const handle = handleOf(args);

  // Tenant isolation lives in the query: another client's id matches nothing.
  const [existing] = await handle.select().from(ltcPolicies).where(scoped(clientId, policyId));
  if (!existing) return writeError(404, "Policy not found");
  const { id: _id, ...stored } = rowToLtcPolicy(existing);
  void _id;
  const merged: LtcPolicyFields = { ...stored };
  for (const [k, v] of Object.entries(d)) {
    if (v !== undefined) (merged as unknown as Record<string, unknown>)[k] = v;
  }
  const problems = ltcPolicyProblems(merged);
  if (problems.length > 0) {
    return writeError(400, "Invalid body", { error: "Invalid body", issues: problems });
  }
  if (merged.kind === "life_rider") {
    const problem = riderLinkProblem(
      merged.insured,
      await loadRiderLifePolicy(clientId, merged.lifePolicyAccountId!, args.tx),
    );
    if (problem) return writeError(400, problem);
  }

  const next = normalizeLtcPolicyFields(merged);
  const changed: Partial<LtcPolicyFields> = {};
  for (const key of LTC_POLICY_FIELD_KEYS) {
    if (next[key] !== stored[key]) (changed as Record<string, unknown>)[key] = next[key];
  }

  const [row] = await handle
    .update(ltcPolicies)
    .set({ ...ltcFieldsToColumns(changed), updatedAt: new Date() })
    .where(scoped(clientId, policyId))
    .returning();
  if (!row) return writeError(404, "Policy not found");

  await recordAudit({
    action: "ltc_policy.update",
    resourceType: "ltc_policy",
    resourceId: policyId,
    clientId,
    firmId,
    actorId,
    metadata: { name: row.name, fieldsChanged: Object.keys(changed), ...(crossFirmMeta ?? {}) },
    tx: args.tx,
  });

  return { ok: true, data: row, resourceId: policyId };
}
