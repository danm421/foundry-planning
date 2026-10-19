// src/lib/fact-finder/save/writers/designations.ts
/**
 * Beneficiary designation lines (Plan 4, D4): an account's set, a life
 * policy's (its id is its account id) and a trust's. A set's record is its
 * parent — an Update's recordId, a Create's parentId (a record made earlier in
 * the save) — and the id other lines' refs to it resolve to.
 *
 * The Details core replaces the whole set, but a line names only the tiers the
 * fact finder filled. So the writer reads the set on the transaction and keeps
 * every row in a tier the line doesn't name — the default beneficiaries a
 * retirement account made earlier in the save got included. On an Update, a
 * tier equal to that tier in the review's snapshot (the field's `onRecord`;
 * Plan 3 carries a blank tier's rows on record into the line) isn't named
 * either: an earlier line of the save may have changed it since (an owner
 * change re-points a retirement account's untouched defaults). The fact finder
 * carries no distribution form: a row naming the same person on record in the
 * same tier keeps theirs.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { beneficiaryDesignations, familyMembers } from "@/db/schema";
import { replaceAccountBeneficiariesForClient, replaceTrustBeneficiariesForClient, type DesignationRow } from "@/lib/clients/beneficiary-designations-writes";
import type { EntityWriteResult } from "@/lib/clients/entity-write-result";
import type { PlacedValue } from "../../change-set";
import { sameValue } from "../../placement/values";
import { SaveLineError, unwrap, type SaveContext, type SaveInput, type SaveWriter } from "../types";

/** A designation row as the routes take it (payloadFor's shape). */
type SetRow = {
  tier: string;
  householdRole?: string | null;
  familyMemberId?: string | null;
  externalBeneficiaryId?: string | null;
  entityIdRef?: string | null;
  distributionForm?: string | null;
  [key: string]: unknown;
};

/** One tier's rows of a set as a line holds it. */
const tierOf = (set: PlacedValue | undefined, tier: string): PlacedValue[] =>
  Array.isArray(set) ? set.filter((e) => (e as { tier?: PlacedValue } | null)?.tier === tier) : [];

/** Refs compared as the line holds them: the line and its snapshot come from one record book. */
const AS_HELD = { client: null, spouse: null };

/** The tiers a line names: on an Update, only those that differ from the review's snapshot. */
function namedTiers(input: SaveInput, update: boolean): Set<string> {
  const next = input.values.beneficiaries;
  const tiers = new Set(Array.isArray(next) ? next.map((e) => String((e as { tier?: PlacedValue }).tier)) : []);
  if (!update) return tiers;
  const reviewed = input.line.fields.find((f) => f.key === "beneficiaries")?.onRecord;
  return new Set([...tiers].filter((tier) => !sameValue("beneficiaries", tierOf(next, tier), tierOf(reviewed, tier), AS_HELD)));
}

/** The line's rows in the tiers it names, then every row on record in the other tiers. */
async function withKeptTiers(ctx: SaveContext, targetKind: "account" | "trust", parentId: string, body: Record<string, unknown>, tiers: Set<string>): Promise<SetRow[]> {
  const named = ((body.beneficiaries ?? []) as SetRow[]).filter((r) => tiers.has(r.tier));
  const onRecord = await ctx.tx
    .select()
    .from(beneficiaryDesignations)
    .where(
      and(
        eq(beneficiaryDesignations.clientId, ctx.clientId),
        eq(beneficiaryDesignations.targetKind, targetKind),
        eq(targetKind === "account" ? beneficiaryDesignations.accountId : beneficiaryDesignations.entityId, parentId),
      ),
    )
    .orderBy(asc(beneficiaryDesignations.sortOrder));
  // A row names the client or co-client by household role or by family member: the same person either way.
  const principals = await ctx.tx
    .select({ id: familyMembers.id, role: familyMembers.role })
    .from(familyMembers)
    .where(and(eq(familyMembers.clientId, ctx.clientId), inArray(familyMembers.role, ["client", "spouse"])));
  const roleOf = new Map(principals.map((p) => [p.id, p.role]));
  const tierAndWho = (r: SetRow) =>
    [r.tier, r.householdRole ?? roleOf.get(r.familyMemberId ?? "") ?? r.familyMemberId, r.externalBeneficiaryId, r.entityIdRef].map((v) => v ?? "").join("|");
  const formOf = new Map(onRecord.flatMap((r) => (r.distributionForm ? [[tierAndWho(r), r.distributionForm] as const] : [])));
  return [
    ...named.map((r) => (formOf.has(tierAndWho(r)) ? { ...r, distributionForm: formOf.get(tierAndWho(r)) } : r)),
    ...onRecord
      .filter((r) => !tiers.has(r.tier))
      .map((r) => ({
        tier: r.tier,
        percentage: Number(r.percentage),
        familyMemberId: r.familyMemberId,
        externalBeneficiaryId: r.externalBeneficiaryId,
        entityIdRef: r.entityIdRef,
        householdRole: r.householdRole,
        sortOrder: r.sortOrder,
        ...(r.distributionForm ? { distributionForm: r.distributionForm } : {}),
      })),
  ];
}

function setWriter(
  targetKind: "account" | "trust",
  replace: (ctx: SaveContext, parentId: string, set: SetRow[]) => Promise<EntityWriteResult<DesignationRow[]>>,
): SaveWriter {
  const write = async (ctx: SaveContext, input: SaveInput, update: boolean): Promise<string> => {
    const parentId = input.recordId ?? input.parentId;
    if (!parentId) throw new SaveLineError("These beneficiaries have no account, policy or trust to go on.");
    unwrap(await replace(ctx, parentId, await withKeptTiers(ctx, targetKind, parentId, input.body, namedTiers(input, update))));
    return parentId;
  };
  return {
    create: (ctx, input) => write(ctx, input, false),
    update: async (ctx, input) => {
      await write(ctx, input, true);
    },
  };
}

const accountSet = setWriter("account", (ctx, accountId, set) =>
  replaceAccountBeneficiariesForClient({ clientId: ctx.clientId, firmId: ctx.firmId, accountId, input: set, tx: ctx.tx, afterCommit: ctx.afterCommit, principal: ctx.principal }),
);

export const DESIGNATION_WRITERS: {
  account_beneficiary_designation: SaveWriter;
  life_insurance_policy_beneficiary: SaveWriter;
  trust_beneficiary_designation: SaveWriter;
} = {
  account_beneficiary_designation: accountSet,
  life_insurance_policy_beneficiary: accountSet,
  trust_beneficiary_designation: setWriter("trust", (ctx, entityId, set) =>
    replaceTrustBeneficiariesForClient({ clientId: ctx.clientId, firmId: ctx.firmId, entityId, input: set, tx: ctx.tx, afterCommit: ctx.afterCommit, principal: ctx.principal }),
  ),
};
