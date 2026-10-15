// src/lib/fact-finder/save/writers/designations.ts
/**
 * Beneficiary designation lines (Plan 4, D4): an account's set, a life
 * policy's (its id is its account id) and a trust's. A set's record is its
 * parent — an Update's recordId, a Create's parentId (a record made earlier in
 * the save) — and the id other lines' refs to it resolve to.
 *
 * The Details core replaces the whole set, but a line names only the tiers the
 * fact finder filled (on an Update, Plan 3's maps carry a blank tier's rows on
 * record into the line). So the writer reads the set on record and keeps every
 * row in a tier the line doesn't name — the default beneficiaries a retirement
 * account made earlier in the save got included. The fact finder carries no
 * distribution form: a row naming someone on record in the same tier keeps
 * theirs.
 */
import { and, asc, eq } from "drizzle-orm";
import { beneficiaryDesignations } from "@/db/schema";
import { replaceAccountBeneficiariesForClient, replaceTrustBeneficiariesForClient, type DesignationRow } from "@/lib/clients/beneficiary-designations-writes";
import type { EntityWriteResult } from "@/lib/clients/entity-write-result";
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

/** A row's tier and whom it names. */
const tierAndWho = (r: SetRow) =>
  [r.tier, r.householdRole, r.familyMemberId, r.externalBeneficiaryId, r.entityIdRef].map((v) => v ?? "").join("|");

/** The line's rows, then every row on record in a tier they don't name. */
async function withKeptTiers(ctx: SaveContext, targetKind: "account" | "trust", parentId: string, body: Record<string, unknown>): Promise<SetRow[]> {
  const named = (body.beneficiaries ?? []) as SetRow[];
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
  const formOf = new Map(onRecord.flatMap((r) => (r.distributionForm ? [[tierAndWho(r), r.distributionForm] as const] : [])));
  const tiers = new Set(named.map((r) => r.tier));
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
  const write = async (ctx: SaveContext, input: SaveInput): Promise<string> => {
    const parentId = input.recordId ?? input.parentId;
    if (!parentId) throw new SaveLineError("These beneficiaries have no account, policy or trust to go on.");
    unwrap(await replace(ctx, parentId, await withKeptTiers(ctx, targetKind, parentId, input.body)));
    return parentId;
  };
  return {
    create: write,
    update: async (ctx, input) => {
      await write(ctx, input);
    },
  };
}

const accountSet = setWriter("account", (ctx, accountId, set) =>
  replaceAccountBeneficiariesForClient({ clientId: ctx.clientId, firmId: ctx.firmId, accountId, input: set, tx: ctx.tx, afterCommit: ctx.afterCommit }),
);

export const DESIGNATION_WRITERS: {
  account_beneficiary_designation: SaveWriter;
  life_insurance_policy_beneficiary: SaveWriter;
  trust_beneficiary_designation: SaveWriter;
} = {
  account_beneficiary_designation: accountSet,
  life_insurance_policy_beneficiary: accountSet,
  trust_beneficiary_designation: setWriter("trust", (ctx, entityId, set) =>
    replaceTrustBeneficiariesForClient({ clientId: ctx.clientId, firmId: ctx.firmId, entityId, input: set, tx: ctx.tx, afterCommit: ctx.afterCommit }),
  ),
};
