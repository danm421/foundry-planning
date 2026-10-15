// src/lib/clients/beneficiary-designations-writes.ts
/**
 * Beneficiary designations: an account's set (PUT /accounts/[accountId]/beneficiaries
 * — a life policy's too, its id is its account id) and a trust's (PUT
 * /entities/[entityId]/beneficiaries). Each call replaces the record's whole
 * set. Moved from the two routes as they were: no audit row, the account set
 * stores no distribution form, a row's sort order is the one sent (the schema
 * defaults it to 0). With `tx` every statement — the record and beneficiary
 * checks included — runs on it, so a set can name records the caller's
 * transaction created.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { accounts, beneficiaryDesignations, entities, externalBeneficiaries, familyMembers } from "@/db/schema";
import { verifyClientAccess } from "@/lib/clients/authz";
import { assertEntitiesInClient } from "@/lib/db-scoping";
import { handleOf, inTransaction, type DbOrTx, type WriteOptions } from "@/lib/db-tx";
import { beneficiarySetSchema, type BeneficiaryDesignationInput } from "@/lib/schemas/beneficiaries";
import { formatZodIssues } from "@/lib/schemas/common";
import { writeError, type EntityWriteResult } from "./entity-write-result";

export type DesignationRow = typeof beneficiaryDesignations.$inferSelect;

/** The client is the caller's and the account is the client's. */
export async function verifyClientAndAccount(clientId: string, accountId: string, handle?: DbOrTx) {
  const a = await verifyClientAccess(clientId);
  if (!a.ok) return false;
  const [account] = await (handle ?? db)
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.clientId, clientId)));
  return !!account;
}

/** The client is the caller's and the entity is the client's trust. */
export async function verifyClientAndTrust(clientId: string, entityId: string, handle?: DbOrTx) {
  const a = await verifyClientAccess(clientId);
  if (!a.ok)
    return { ok: false as const, reason: "client" as const };
  const [entity] = await (handle ?? db)
    .select({ id: entities.id, entityType: entities.entityType })
    .from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.clientId, clientId)));
  if (!entity) return { ok: false as const, reason: "entity" as const };
  if (entity.entityType !== "trust")
    return { ok: false as const, reason: "not_trust" as const };
  return { ok: true as const };
}

/** The family members and outside beneficiaries a set names are the client's — both routes' own checks. */
async function peopleProblem(handle: DbOrTx, clientId: string, set: BeneficiaryDesignationInput[]): Promise<string | null> {
  const fmIds = set.map((d) => d.familyMemberId).filter((x): x is string => !!x);
  const extIds = set.map((d) => d.externalBeneficiaryId).filter((x): x is string => !!x);
  if (fmIds.length > 0) {
    const found = await handle
      .select({ id: familyMembers.id })
      .from(familyMembers)
      .where(and(eq(familyMembers.clientId, clientId), inArray(familyMembers.id, fmIds)));
    if (found.length !== new Set(fmIds).size) return "One or more family members not found for this client";
  }
  if (extIds.length > 0) {
    const found = await handle
      .select({ id: externalBeneficiaries.id })
      .from(externalBeneficiaries)
      .where(
        and(
          eq(externalBeneficiaries.clientId, clientId),
          inArray(externalBeneficiaries.id, extIds),
        ),
      );
    if (found.length !== new Set(extIds).size) return "One or more external beneficiaries not found for this client";
  }
  return null;
}

/** An account's (or life policy's) beneficiaries, replaced by `input` — the account route's PUT. */
export async function replaceAccountBeneficiariesForClient(
  args: { clientId: string; firmId: string; accountId: string; input: unknown } & WriteOptions,
): Promise<EntityWriteResult<DesignationRow[]>> {
  const { clientId, accountId } = args;
  const handle = handleOf(args);
  if (!(await verifyClientAndAccount(clientId, accountId, handle))) return writeError(404, "Not found");
  const parsed = beneficiarySetSchema.safeParse(args.input);
  if (!parsed.success) {
    return writeError(400, "Invalid body", { error: "Invalid body", issues: formatZodIssues(parsed.error) });
  }

  const people = await peopleProblem(handle, clientId, parsed.data);
  if (people) return writeError(400, people);

  const entIds = parsed.data
    .map((d) => d.entityIdRef)
    .filter((x): x is string => !!x);
  if (entIds.length > 0) {
    const found = await handle
      .select({ id: entities.id })
      .from(entities)
      .where(
        and(eq(entities.clientId, clientId), inArray(entities.id, entIds)),
      );
    if (found.length !== new Set(entIds).size) {
      return writeError(400, "One or more trust entities not found for this client");
    }
  }

  const inserted = await inTransaction(args, async (tx) => {
    await tx
      .delete(beneficiaryDesignations)
      .where(
        and(
          eq(beneficiaryDesignations.clientId, clientId),
          eq(beneficiaryDesignations.targetKind, "account"),
          eq(beneficiaryDesignations.accountId, accountId),
        ),
      );
    if (parsed.data.length === 0) return [];
    return tx
      .insert(beneficiaryDesignations)
      .values(
        parsed.data.map((d, idx) => ({
          clientId,
          targetKind: "account" as const,
          accountId,
          entityId: null,
          tier: d.tier,
          familyMemberId: d.familyMemberId ?? null,
          externalBeneficiaryId: d.externalBeneficiaryId ?? null,
          entityIdRef: d.entityIdRef ?? null,
          householdRole: d.householdRole ?? null,
          percentage: String(d.percentage),
          sortOrder: d.sortOrder ?? idx,
        })),
      )
      .returning();
  });

  return { ok: true, data: inserted, resourceId: accountId };
}

/** A trust's beneficiaries, replaced by `input` — the trust route's PUT. */
export async function replaceTrustBeneficiariesForClient(
  args: { clientId: string; firmId: string; entityId: string; input: unknown } & WriteOptions,
): Promise<EntityWriteResult<DesignationRow[]>> {
  const { clientId, entityId } = args;
  const handle = handleOf(args);
  const v = await verifyClientAndTrust(clientId, entityId, handle);
  if (!v.ok) {
    return v.reason === "not_trust" ? writeError(400, "Entity is not a trust") : writeError(404, "Not found");
  }
  const parsed = beneficiarySetSchema.safeParse(args.input);
  if (!parsed.success) {
    return writeError(400, "Invalid body", { error: "Invalid body", issues: formatZodIssues(parsed.error) });
  }

  const people = await peopleProblem(handle, clientId, parsed.data);
  if (people) return writeError(400, people);

  // A beneficiary can itself be a trust. Its id is request-supplied and the
  // sibling account route already asserts it — this one did not, so a foreign
  // entity id landed in `beneficiary_designations` unchecked.
  const entCheck = await assertEntitiesInClient(
    clientId,
    parsed.data.map((d) => d.entityIdRef),
    args.tx,
  );
  if (!entCheck.ok) {
    return writeError(400, "One or more trust entities not found for this client");
  }

  const inserted = await inTransaction(args, async (tx) => {
    await tx
      .delete(beneficiaryDesignations)
      .where(
        and(
          eq(beneficiaryDesignations.clientId, clientId),
          eq(beneficiaryDesignations.targetKind, "trust"),
          eq(beneficiaryDesignations.entityId, entityId),
        ),
      );
    if (parsed.data.length === 0) return [];
    return tx
      .insert(beneficiaryDesignations)
      .values(
        parsed.data.map((d, idx) => ({
          clientId,
          targetKind: "trust" as const,
          accountId: null,
          entityId,
          tier: d.tier,
          familyMemberId: d.familyMemberId ?? null,
          externalBeneficiaryId: d.externalBeneficiaryId ?? null,
          entityIdRef: d.entityIdRef ?? null,
          householdRole: d.householdRole ?? null,
          distributionForm: d.distributionForm ?? null,
          percentage: String(d.percentage),
          sortOrder: d.sortOrder ?? idx,
        })),
      )
      .returning();
  });

  return { ok: true, data: inserted, resourceId: entityId };
}
