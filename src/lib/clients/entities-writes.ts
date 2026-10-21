// Entity (trust / business / foundation) write core: the create and update
// paths of POST /api/clients/[id]/entities and PUT …/entities/[entityId],
// moved verbatim so the fact finder save can run them on its transaction
// (Plan 4, D3). The routes keep their gates, their responses and DELETE.
//
// Called without `tx` every statement runs as the routes ran it: the create's
// checks on module `db` and its writes in one transaction of its own; the
// update statement by statement on module `db` — not atomic, so a grantor
// refusal can follow the entity's update, as before. Called with `tx`, every
// read, write and audit row runs on it. The audit rows stay metadata-style;
// without `actorId` the actor comes from the Clerk session, as before.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  accountOwners,
  accounts,
  entities,
  entityOwners,
  familyMembers,
  gifts,
  scenarios,
  trustSplitInterestDetails,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { assertExternalBeneficiariesInClient, assertFamilyMembersInClient } from "@/lib/db-scoping";
import { handleOf, inTransaction, type DbOrTx, type WriteOptions } from "@/lib/db-tx";
import { computeCltInceptionInterests } from "@/lib/entities/compute-clt-inception";
import { computeCrtInceptionInterests } from "@/lib/entities/compute-crt-inception";
import type { TrustSubType } from "@/lib/entities/trust";
import { formatZodIssues } from "@/lib/schemas/common";
import { entityCreateSchema, entityUpdateSchema } from "@/lib/schemas/entities";
import type { TrustSplitInterestInput } from "@/lib/schemas/trust-split-interest";
import { writeError, type EntityWriteResult } from "./entity-write-result";
import { currentPlanningYear } from "@/lib/plan-year";

type EntityRow = typeof entities.$inferSelect;
/** The route's response: the entity row and its family-member owners. */
type EntityWithOwners = EntityRow & {
  owners: { kind: "family_member"; familyMemberId: string | null; percent: number }[];
};

/** Derive the legacy `owner` enum from the multi-owner allocation. Used to
 *  keep the deprecated column populated for back-compat readers (balance-sheet
 *  filter, family-view). Returns null when the owners array doesn't fit a
 *  client/spouse/joint shape. */
function deriveLegacyOwner(
  ownersInput: { familyMemberId: string; percent: number }[] | undefined,
  members: { id: string; role: "client" | "spouse" | "child" | "other" }[],
): "client" | "spouse" | "joint" | null {
  if (!ownersInput || ownersInput.length === 0) return null;
  const clientId = members.find((m) => m.role === "client")?.id;
  const spouseId = members.find((m) => m.role === "spouse")?.id;
  const total = ownersInput.reduce((s, o) => s + o.percent, 0);
  if (Math.abs(total - 1) > 0.0001) return null;
  if (ownersInput.length === 1) {
    const o = ownersInput[0];
    if (o.familyMemberId === clientId) return "client";
    if (o.familyMemberId === spouseId) return "spouse";
  }
  if (ownersInput.length === 2 && clientId && spouseId) {
    const c = ownersInput.find((o) => o.familyMemberId === clientId);
    const s = ownersInput.find((o) => o.familyMemberId === spouseId);
    if (c && s && Math.abs(c.percent - 0.5) < 0.0001 && Math.abs(s.percent - 0.5) < 0.0001) {
      return "joint";
    }
  }
  return null;
}

/** Validation failure raised from inside the entity-creation transaction so
 *  the partial writes roll back; mapped to a 400 (audit F6). */
class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

export async function createEntityForClient(
  args: {
    clientId: string;
    firmId: string;
    actorId?: string;
    input: unknown;
    crossFirmMeta?: Record<string, unknown>;
  } & WriteOptions,
): Promise<EntityWriteResult<EntityWithOwners>> {
  const { clientId: id, firmId, actorId, input: body, crossFirmMeta } = args;
  const handle = handleOf(args);

  const parsed = entityCreateSchema.safeParse(body);
  if (!parsed.success) {
    return writeError(400, "Invalid body", { error: "Invalid body", issues: formatZodIssues(parsed.error) });
  }
  const data = parsed.data;

  if (data.splitInterest) {
    const ext = await assertExternalBeneficiariesInClient(id, [
      data.splitInterest.charityId,
    ], args.tx);
    if (!ext.ok) {
      return writeError(400, ext.reason);
    }
  }

  // Load household family members so we can validate ownership refs and
  // derive the legacy owner enum for back-compat readers.
  const householdMembers = await handle
    .select({ id: familyMembers.id, role: familyMembers.role })
    .from(familyMembers)
    .where(eq(familyMembers.clientId, id));
  if (data.owners && data.owners.length > 0) {
    const memberIds = new Set(householdMembers.map((m) => m.id));
    for (const o of data.owners) {
      if (!memberIds.has(o.familyMemberId)) {
        return writeError(400, `owners.familyMemberId ${o.familyMemberId} does not belong to this client`);
      }
    }
    const total = data.owners.reduce((s, o) => s + o.percent, 0);
    if (Math.abs(total - 1) > 0.0001) {
      return writeError(400, "owners percent must sum to 1.0");
    }
  }
  const legacyOwner =
    data.entityType === "trust" || data.entityType === "foundation"
      ? null
      : (deriveLegacyOwner(data.owners, householdMembers) ?? data.owner ?? null);

  // Insert entity_owners rows for business-type entities. Trusts skip this —
  // their grantor/beneficiary structure is captured in dedicated columns.
  const isBusinessType = !["trust", "foundation"].includes(data.entityType);

  // Only base-case scenarios receive the default checking account — the
  // accounts_scenario_base_only trigger rejects writes to non-base scenarios.
  const scenarioRows = await handle
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(and(eq(scenarios.clientId, id), eq(scenarios.isBaseCase, true)));

  // All entity-creation writes (entity row + owners + per-scenario default
  // checking accounts + optional split-interest details/auto-gift) must
  // commit together or not at all (audit F6). Validation that should abort
  // throws BadRequestError → rolls the transaction back → mapped to 400. On a
  // caller's transaction the caller rolls back: the save does on any refusal.
  let written;
  try {
    written = await inTransaction(args, async (tx) => {
      let trustSplitAudit: Record<string, unknown> | null = null;
      const [entity] = await tx
        .insert(entities)
        .values({
          clientId: id,
          name: data.name,
          entityType: data.entityType,
          notes: data.notes ?? null,
          includeInPortfolio: data.includeInPortfolio ?? false,
          accessibleToClient: data.accessibleToClient ?? false,
          crummeyPowers: data.crummeyPowers ?? false,
          isGrantor: data.isGrantor ?? false,
          grantorStatusEndYear: data.grantorStatusEndYear ?? null,
          value: data.value != null ? String(data.value) : "0",
          basis: data.basis != null ? String(data.basis) : "0",
          owner: legacyOwner,
          grantor: data.grantor ?? null,
          beneficiaries: data.beneficiaries ?? null,
          trustSubType:
            data.entityType === "trust"
              ? ((data.trustSubType ?? null) as TrustSubType | null)
              : null,
          isIrrevocable:
            data.entityType === "trust" ? data.isIrrevocable ?? null : null,
          trustee: data.entityType === "trust" ? data.trustee ?? null : null,
          trustEnds: data.entityType === "trust" ? (data.trustEnds ?? null) : null,
          distributionMode:
            data.entityType === "trust"
              ? (data.distributionMode ?? null)
              : null,
          distributionAmount:
            data.entityType === "trust" && data.distributionAmount != null
              ? String(data.distributionAmount)
              : null,
          distributionPercent:
            data.entityType === "trust" && data.distributionPercent != null
              ? String(data.distributionPercent)
              : null,
          taxTreatment: data.taxTreatment ?? "ordinary",
          distributionPolicyPercent:
            data.entityType !== "trust" && data.entityType !== "foundation" && data.distributionPolicyPercent != null
              ? String(data.distributionPolicyPercent)
              : null,
          valueGrowthRate:
            data.entityType !== "trust" && data.entityType !== "foundation" && data.valueGrowthRate != null
              ? String(data.valueGrowthRate)
              : null,
        })
        .returning();

      if (isBusinessType && data.owners && data.owners.length > 0) {
        await tx.insert(entityOwners).values(
          data.owners.map((o) => ({
            entityId: entity.id,
            familyMemberId: o.familyMemberId,
            percent: String(o.percent),
          })),
        );
      }

      // Create a default checking account per base-case scenario so the
      // projection engine can route the entity's incomes/expenses/RMDs through
      // a dedicated cash bucket, then wire ownership via account_owners.
      if (scenarioRows.length > 0) {
        const insertedAccounts = await tx.insert(accounts).values(
          scenarioRows.map((s) => ({
            clientId: id,
            scenarioId: s.id,
            name: `${entity.name} — Cash`,
            category: "cash" as const,
            subType: "checking" as const,
            value: "0",
            basis: "0",
            growthRate: null,
            rmdEnabled: false,
            isDefaultChecking: true,
          }))
        ).returning({ id: accounts.id });

        if (insertedAccounts.length > 0) {
          await tx.insert(accountOwners).values(
            insertedAccounts.map((a) => ({
              accountId: a.id,
              entityId: entity.id,
              familyMemberId: null,
              percent: "1.0000",
            }))
          );
        }
      }

      if (
        (data.trustSubType === "clt" || data.trustSubType === "crt") &&
        data.splitInterest
      ) {
        const si = data.splitInterest;

        if (data.grantor !== "client" && data.grantor !== "spouse") {
          throw new BadRequestError(
            `grantor (the client or the Co-client) is required for ${data.trustSubType === "crt" ? "CRTs" : "CLTs"}`,
          );
        }

        const measuringLife1 = si.measuringLife1Id
          ? (await tx
              .select()
              .from(familyMembers)
              .where(
                and(
                  eq(familyMembers.id, si.measuringLife1Id),
                  eq(familyMembers.clientId, id),
                ),
              )
              .limit(1))[0]
          : null;
        const measuringLife2 = si.measuringLife2Id
          ? (await tx
              .select()
              .from(familyMembers)
              .where(
                and(
                  eq(familyMembers.id, si.measuringLife2Id),
                  eq(familyMembers.clientId, id),
                ),
              )
              .limit(1))[0]
          : null;

        if (si.measuringLife1Id && !measuringLife1) {
          throw new BadRequestError(
            "measuringLife1Id does not belong to this client",
          );
        }
        if (si.measuringLife2Id && !measuringLife2) {
          throw new BadRequestError(
            "measuringLife2Id does not belong to this client",
          );
        }

        const ageAtFromDob = (
          dob: string | null,
          year: number,
        ): number | undefined => {
          if (!dob) return undefined;
          return year - parseInt(dob.slice(0, 4), 10);
        };

        const age1 = measuringLife1
          ? ageAtFromDob(measuringLife1.dateOfBirth, si.inceptionYear)
          : undefined;
        const age2 = measuringLife2
          ? ageAtFromDob(measuringLife2.dateOfBirth, si.inceptionYear)
          : undefined;

        if (
          (si.termType === "single_life" ||
            si.termType === "joint_life" ||
            si.termType === "shorter_of_years_or_life") &&
          age1 == null
        ) {
          throw new BadRequestError(
            "measuring life 1 is missing date_of_birth",
          );
        }
        if (si.termType === "joint_life" && age2 == null) {
          throw new BadRequestError(
            "measuring life 2 is missing date_of_birth",
          );
        }

        const isExisting = si.origin === "existing";
        const isCrt = data.trustSubType === "crt";

        // Normalize both compute paths to the same DB-row shape:
        //   originalIncomeInterest    = the "income side" PV (gift for CLT, retained-income PV for CRT)
        //   originalRemainderInterest = the "remainder side" PV (taxable gift for CLT, charitable deduction for CRT)
        const interests = isExisting
          ? {
              originalIncomeInterest: si.originalIncomeInterest!,
              originalRemainderInterest: si.originalRemainderInterest!,
              remainderFactor: undefined as number | undefined,
            }
          : isCrt
            ? (() => {
                const r = computeCrtInceptionInterests({
                  inceptionValue: si.inceptionValue,
                  payoutType: si.payoutType,
                  payoutPercent: si.payoutPercent,
                  payoutAmount: si.payoutAmount,
                  irc7520Rate: si.irc7520Rate,
                  termType: si.termType,
                  termYears: si.termYears,
                  measuringLifeAge1: age1,
                  measuringLifeAge2: age2,
                });
                return {
                  originalIncomeInterest: r.incomeInterest,
                  originalRemainderInterest: r.charitableDeduction,
                  remainderFactor: r.remainderFactor,
                };
              })()
            : computeCltInceptionInterests({
                inceptionValue: si.inceptionValue,
                payoutType: si.payoutType,
                payoutPercent: si.payoutPercent,
                payoutAmount: si.payoutAmount,
                irc7520Rate: si.irc7520Rate,
                termType: si.termType,
                termYears: si.termYears,
                measuringLifeAge1: age1,
                measuringLifeAge2: age2,
              });

        await tx.insert(trustSplitInterestDetails).values({
          entityId: entity.id,
          clientId: id,
          inceptionYear: si.inceptionYear,
          inceptionValue: si.inceptionValue.toString(),
          payoutType: si.payoutType,
          payoutPercent: si.payoutPercent != null ? si.payoutPercent.toString() : null,
          payoutAmount: si.payoutAmount != null ? si.payoutAmount.toString() : null,
          irc7520Rate: si.irc7520Rate.toString(),
          termType: si.termType,
          termYears: si.termYears ?? null,
          measuringLife1Id: si.measuringLife1Id ?? null,
          measuringLife2Id: si.measuringLife2Id ?? null,
          charityId: si.charityId,
          originalIncomeInterest: interests.originalIncomeInterest.toString(),
          originalRemainderInterest: interests.originalRemainderInterest.toString(),
        });

        // Auto-emit the remainder-interest gift only for NEW CLTs. CRTs do not
        // emit a gift at inception (income beneficiary = grantor / spouse, so
        // there's either no transfer or a marital deduction applies).
        if (!isExisting && !isCrt) {
          await tx.insert(gifts).values({
            clientId: id,
            year: si.inceptionYear,
            amount: interests.originalRemainderInterest.toString(),
            grantor: data.grantor,
            recipientEntityId: entity.id,
            eventKind: "clt_remainder_interest",
            enteredAsHistory: si.inceptionYear < currentPlanningYear(),
            notes: `Auto-emitted at CLT '${data.name}' inception. Remainder interest gift = ${interests.originalRemainderInterest}; income interest (charitable deduction) = ${interests.originalIncomeInterest}.`,
          });
        }

        trustSplitAudit = {
          subType: data.trustSubType,
          origin: si.origin ?? "new",
          inceptionYear: si.inceptionYear,
          inceptionValue: si.inceptionValue,
          payoutPercent: si.payoutPercent,
          termType: si.termType,
          termYears: si.termYears,
          remainderFactor: interests.remainderFactor,
          originalIncomeInterest: interests.originalIncomeInterest,
          originalRemainderInterest: interests.originalRemainderInterest,
        };
      }

      return { entity, trustSplitAudit };
    });
  } catch (err) {
    if (err instanceof BadRequestError) return writeError(400, err.message);
    throw err;
  }
  const { entity, trustSplitAudit } = written;

  if (trustSplitAudit) {
    await recordAudit({
      action: "trust_split_interest.create",
      resourceType: "trust_split_interest_details",
      resourceId: entity.id,
      clientId: id,
      firmId,
      metadata: { ...trustSplitAudit, ...crossFirmMeta },
      actorId,
      tx: args.tx,
    });
  }

  await recordAudit({
    action: "entity.create",
    resourceType: "entity",
    resourceId: entity.id,
    clientId: id,
    firmId,
    metadata: { name: entity.name, entityType: entity.entityType, ...crossFirmMeta },
    actorId,
    tx: args.tx,
  });

  const responseOwners = isBusinessType && data.owners
    ? data.owners.map((o) => ({
        kind: "family_member" as const,
        familyMemberId: o.familyMemberId,
        percent: o.percent,
      }))
    : [];
  return { ok: true, data: { ...entity, owners: responseOwners }, resourceId: entity.id };
}

/** The client's entity, or null. The PUT route runs it before it reads the body
 *  (a missing entity answers 404 whatever the body), the core again on its handle. */
export async function verifyEntity(entityId: string, clientId: string, handle?: DbOrTx): Promise<EntityRow | null> {
  const [existing] = await (handle ?? db)
    .select()
    .from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.clientId, clientId)));
  return existing ?? null;
}

export async function updateEntityForClient(
  args: {
    clientId: string;
    firmId: string;
    actorId?: string;
    entityId: string;
    input: unknown;
    crossFirmMeta?: Record<string, unknown>;
  } & WriteOptions,
): Promise<EntityWriteResult<EntityWithOwners>> {
  const { clientId: id, firmId, actorId, entityId, input: body, crossFirmMeta } = args;
  const handle = handleOf(args);

  const existing = await verifyEntity(entityId, id, args.tx);
  if (!existing) {
    return writeError(404, "Entity not found");
  }

  const parsed = entityUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return writeError(400, "Invalid body", { error: "Invalid body", issues: formatZodIssues(parsed.error) });
  }
  const patch = parsed.data as {
    name?: string;
    entityType?: typeof existing.entityType;
    notes?: string | null;
    includeInPortfolio?: boolean;
    accessibleToClient?: boolean;
    crummeyPowers?: boolean;
    isGrantor?: boolean;
    grantorStatusEndYear?: number | null;
    value?: string | number;
    basis?: string | number;
    owner?: "client" | "spouse" | "joint" | null;
    owners?: { familyMemberId: string; percent: number }[];
    grantor?: "client" | "spouse" | null;
    beneficiaries?: Array<{ name: string; pct: number }> | null;
    trustSubType?: string;
    isIrrevocable?: boolean;
    trustee?: string | null;
    trustEnds?: "client_death" | "spouse_death" | "survivorship" | null;
    distributionMode?: "fixed" | "pct_liquid" | "pct_income" | null;
    distributionAmount?: number | null;
    distributionPercent?: number | null;
    taxTreatment?: "qbi" | "ordinary" | "non_taxable";
    distributionPolicyPercent?: number | null;
    flowMode?: "annual" | "schedule";
    valueGrowthRate?: number | null;
    splitInterest?: TrustSplitInterestInput;
  };

  if (patch.splitInterest) {
    const si = patch.splitInterest;
    const ext = await assertExternalBeneficiariesInClient(id, [si.charityId], args.tx);
    if (!ext.ok) {
      return writeError(400, ext.reason);
    }
    const fm = await assertFamilyMembersInClient(id, [
      si.measuringLife1Id,
      si.measuringLife2Id,
    ], args.tx);
    if (!fm.ok) {
      return writeError(400, fm.reason);
    }
  }

  const householdMembers = await handle
    .select({ id: familyMembers.id, role: familyMembers.role })
    .from(familyMembers)
    .where(eq(familyMembers.clientId, id));

  if (patch.owners) {
    const memberIds = new Set(householdMembers.map((m) => m.id));
    for (const o of patch.owners) {
      if (!memberIds.has(o.familyMemberId)) {
        return writeError(400, `owners.familyMemberId ${o.familyMemberId} does not belong to this client`);
      }
    }
    if (patch.owners.length > 0) {
      const total = patch.owners.reduce((s, o) => s + o.percent, 0);
      if (Math.abs(total - 1) > 0.0001) {
        return writeError(400, "owners percent must sum to 1.0");
      }
    }
  }

  const effectiveType = patch.entityType ?? existing.entityType;
  const isBusinessType = !["trust", "foundation"].includes(effectiveType);
  const ownerEnumFromOwners =
    patch.owners !== undefined && isBusinessType
      ? deriveLegacyOwner(patch.owners, householdMembers)
      : undefined;

  // For CLT entities, the merged-validation block below requires splitInterest
  // to be present (entityCreateSchema enforces this). Hydrate the existing row
  // so a non-splitInterest patch on a CLT still validates.
  const [existingSplitInterest] = await handle
    .select()
    .from(trustSplitInterestDetails)
    .where(eq(trustSplitInterestDetails.entityId, entityId));
  const hydratedSplitInterest: TrustSplitInterestInput | undefined =
    patch.splitInterest ??
    (existingSplitInterest
      ? ({
          inceptionYear: existingSplitInterest.inceptionYear,
          inceptionValue: Number(existingSplitInterest.inceptionValue),
          payoutType: existingSplitInterest.payoutType,
          payoutPercent:
            existingSplitInterest.payoutPercent != null
              ? Number(existingSplitInterest.payoutPercent)
              : undefined,
          payoutAmount:
            existingSplitInterest.payoutAmount != null
              ? Number(existingSplitInterest.payoutAmount)
              : undefined,
          irc7520Rate: Number(existingSplitInterest.irc7520Rate),
          termType: existingSplitInterest.termType,
          termYears: existingSplitInterest.termYears ?? undefined,
          measuringLife1Id: existingSplitInterest.measuringLife1Id ?? undefined,
          measuringLife2Id: existingSplitInterest.measuringLife2Id ?? undefined,
          charityId: existingSplitInterest.charityId,
        } as TrustSplitInterestInput)
      : undefined);

  const merged = {
    name: patch.name ?? existing.name,
    entityType: patch.entityType ?? existing.entityType,
    notes: patch.notes !== undefined ? patch.notes : existing.notes,
    includeInPortfolio: patch.includeInPortfolio ?? existing.includeInPortfolio,
    accessibleToClient: patch.accessibleToClient ?? existing.accessibleToClient,
    crummeyPowers: patch.crummeyPowers ?? existing.crummeyPowers,
    isGrantor: patch.isGrantor ?? existing.isGrantor,
    grantorStatusEndYear: patch.grantorStatusEndYear !== undefined ? patch.grantorStatusEndYear : existing.grantorStatusEndYear ?? null,
    value: patch.value ?? existing.value,
    basis: patch.basis ?? existing.basis,
    owner:
      ownerEnumFromOwners !== undefined
        ? ownerEnumFromOwners
        : patch.owner !== undefined
          ? patch.owner
          : existing.owner,
    grantor: patch.grantor !== undefined ? patch.grantor : existing.grantor,
    beneficiaries:
      patch.beneficiaries !== undefined ? patch.beneficiaries : existing.beneficiaries,
    trustSubType:
      patch.trustSubType !== undefined
        ? patch.trustSubType
        : existing.trustSubType ?? undefined,
    isIrrevocable:
      patch.isIrrevocable !== undefined
        ? patch.isIrrevocable
        : existing.isIrrevocable ?? undefined,
    trustee: patch.trustee !== undefined ? patch.trustee : existing.trustee,
    trustEnds: patch.trustEnds !== undefined ? patch.trustEnds : existing.trustEnds,
    distributionMode:
      patch.distributionMode !== undefined
        ? patch.distributionMode
        : existing.distributionMode,
    distributionAmount:
      patch.distributionAmount !== undefined
        ? patch.distributionAmount
        : existing.distributionAmount != null
          ? Number(existing.distributionAmount)
          : null,
    distributionPercent:
      patch.distributionPercent !== undefined
        ? patch.distributionPercent
        : existing.distributionPercent != null
          ? Number(existing.distributionPercent)
          : null,
    splitInterest: hydratedSplitInterest,
  };

  const mergedCheck = entityCreateSchema.safeParse(merged);
  if (!mergedCheck.success) {
    return writeError(400, "Resulting entity would be invalid", {
      error: "Resulting entity would be invalid",
      issues: mergedCheck.error.issues,
    });
  }

  const typeSwitchedAwayFromTrust =
    patch.entityType !== undefined &&
    patch.entityType !== "trust" &&
    existing.entityType === "trust";

  const existingWasBusiness = !["trust", "foundation"].includes(
    existing.entityType,
  );
  const typeSwitchedAwayFromBusiness =
    patch.entityType !== undefined &&
    existingWasBusiness &&
    !isBusinessType;

  const [updated] = await handle
    .update(entities)
    .set({
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.entityType !== undefined && { entityType: patch.entityType }),
      ...(patch.notes !== undefined && { notes: patch.notes }),
      ...(patch.includeInPortfolio !== undefined && {
        includeInPortfolio: Boolean(patch.includeInPortfolio),
      }),
      ...(patch.accessibleToClient !== undefined && {
        accessibleToClient: Boolean(patch.accessibleToClient),
      }),
      ...(patch.crummeyPowers !== undefined && {
        crummeyPowers: Boolean(patch.crummeyPowers),
      }),
      ...(patch.isGrantor !== undefined && {
        isGrantor: Boolean(patch.isGrantor),
      }),
      ...(patch.grantorStatusEndYear !== undefined && {
        grantorStatusEndYear: patch.grantorStatusEndYear ?? null,
      }),
      ...(patch.value !== undefined && { value: String(patch.value) }),
      ...(patch.basis !== undefined && { basis: String(patch.basis) }),
      ...(ownerEnumFromOwners !== undefined
        ? { owner: ownerEnumFromOwners }
        : patch.owner !== undefined
          ? { owner: patch.owner ?? null }
          : {}),
      ...(patch.grantor !== undefined && { grantor: patch.grantor ?? null }),
      ...(patch.beneficiaries !== undefined && {
        beneficiaries: patch.beneficiaries ?? null,
      }),
      ...(patch.trustSubType !== undefined && {
        trustSubType: patch.trustSubType as TrustSubType,
      }),
      ...(patch.isIrrevocable !== undefined && {
        isIrrevocable: patch.isIrrevocable,
      }),
      ...(patch.trustee !== undefined && { trustee: patch.trustee ?? null }),
      ...(patch.trustEnds !== undefined && { trustEnds: patch.trustEnds ?? null }),
      ...(patch.distributionMode !== undefined && {
        distributionMode: patch.distributionMode,
      }),
      ...(patch.distributionAmount !== undefined && {
        distributionAmount:
          patch.distributionAmount != null
            ? String(patch.distributionAmount)
            : null,
      }),
      ...(patch.distributionPercent !== undefined && {
        distributionPercent:
          patch.distributionPercent != null
            ? String(patch.distributionPercent)
            : null,
      }),
      ...(patch.taxTreatment !== undefined && { taxTreatment: patch.taxTreatment }),
      ...(patch.distributionPolicyPercent !== undefined && {
        distributionPolicyPercent:
          patch.distributionPolicyPercent != null
            ? String(patch.distributionPolicyPercent)
            : null,
      }),
      ...(patch.flowMode !== undefined && { flowMode: patch.flowMode }),
      ...(patch.valueGrowthRate !== undefined && {
        valueGrowthRate:
          patch.valueGrowthRate != null
            ? String(patch.valueGrowthRate)
            : null,
      }),
      ...(typeSwitchedAwayFromTrust && {
        trustSubType: null,
        isIrrevocable: null,
        trustee: null,
        trustEnds: null,
        distributionMode: null,
        distributionAmount: null,
        distributionPercent: null,
      }),
      ...(typeSwitchedAwayFromBusiness && {
        distributionPolicyPercent: null,
        valueGrowthRate: null,
      }),
      updatedAt: new Date(),
    })
    .where(and(eq(entities.id, entityId), eq(entities.clientId, id)))
    .returning();

  if (!updated) {
    return writeError(404, "Entity not found");
  }

  // If owners were provided, replace the entity_owners set wholesale.
  // Skip for trust/foundation types — those don't use entity_owners.
  if (patch.owners !== undefined && isBusinessType) {
    await handle.delete(entityOwners).where(eq(entityOwners.entityId, entityId));
    if (patch.owners.length > 0) {
      await handle.insert(entityOwners).values(
        patch.owners.map((o) => ({
          entityId,
          familyMemberId: o.familyMemberId,
          percent: String(o.percent),
        })),
      );
    }
  }

  // Type switched away from a business kind → clear any owner rows.
  if (
    patch.entityType !== undefined &&
    !isBusinessType &&
    ["llc", "s_corp", "c_corp", "partnership", "other"].includes(existing.entityType)
  ) {
    await handle.delete(entityOwners).where(eq(entityOwners.entityId, entityId));
  }

  if (
    patch.splitInterest &&
    (updated.trustSubType === "clt" || updated.trustSubType === "crt")
  ) {
    const si = patch.splitInterest;
    const grantor = updated.grantor;
    if (grantor !== "client" && grantor !== "spouse") {
      return writeError(
        400,
        `grantor (the client or the Co-client) is required for ${updated.trustSubType === "crt" ? "CRTs" : "CLTs"}`,
      );
    }

    const measuringLife1 = si.measuringLife1Id
      ? (await handle
          .select()
          .from(familyMembers)
          .where(
            and(
              eq(familyMembers.id, si.measuringLife1Id),
              eq(familyMembers.clientId, id),
            ),
          )
          .limit(1))[0]
      : null;
    const measuringLife2 = si.measuringLife2Id
      ? (await handle
          .select()
          .from(familyMembers)
          .where(
            and(
              eq(familyMembers.id, si.measuringLife2Id),
              eq(familyMembers.clientId, id),
            ),
          )
          .limit(1))[0]
      : null;

    const ageAtFromDob = (
      dob: string | null,
      year: number,
    ): number | undefined => {
      if (!dob) return undefined;
      return year - parseInt(dob.slice(0, 4), 10);
    };

    const isExisting = si.origin === "existing";
    const isCrt = updated.trustSubType === "crt";

    // Normalize both compute paths to the same DB-row shape:
    //   originalIncomeInterest    = the "income side" PV (gift for CLT, retained-income PV for CRT)
    //   originalRemainderInterest = the "remainder side" PV (taxable gift for CLT, charitable deduction for CRT)
    const interests = isExisting
      ? {
          originalIncomeInterest: si.originalIncomeInterest!,
          originalRemainderInterest: si.originalRemainderInterest!,
          remainderFactor: undefined as number | undefined,
        }
      : isCrt
        ? (() => {
            const r = computeCrtInceptionInterests({
              inceptionValue: si.inceptionValue,
              payoutType: si.payoutType,
              payoutPercent: si.payoutPercent,
              payoutAmount: si.payoutAmount,
              irc7520Rate: si.irc7520Rate,
              termType: si.termType,
              termYears: si.termYears,
              measuringLifeAge1: measuringLife1
                ? ageAtFromDob(measuringLife1.dateOfBirth, si.inceptionYear)
                : undefined,
              measuringLifeAge2: measuringLife2
                ? ageAtFromDob(measuringLife2.dateOfBirth, si.inceptionYear)
                : undefined,
            });
            return {
              originalIncomeInterest: r.incomeInterest,
              originalRemainderInterest: r.charitableDeduction,
              remainderFactor: r.remainderFactor,
            };
          })()
        : computeCltInceptionInterests({
            inceptionValue: si.inceptionValue,
            payoutType: si.payoutType,
            payoutPercent: si.payoutPercent,
            payoutAmount: si.payoutAmount,
            irc7520Rate: si.irc7520Rate,
            termType: si.termType,
            termYears: si.termYears,
            measuringLifeAge1: measuringLife1
              ? ageAtFromDob(measuringLife1.dateOfBirth, si.inceptionYear)
              : undefined,
            measuringLifeAge2: measuringLife2
              ? ageAtFromDob(measuringLife2.dateOfBirth, si.inceptionYear)
              : undefined,
          });

    const valuesToWrite = {
      entityId,
      clientId: id,
      inceptionYear: si.inceptionYear,
      inceptionValue: si.inceptionValue.toString(),
      payoutType: si.payoutType,
      payoutPercent: si.payoutPercent != null ? si.payoutPercent.toString() : null,
      payoutAmount: si.payoutAmount != null ? si.payoutAmount.toString() : null,
      irc7520Rate: si.irc7520Rate.toString(),
      termType: si.termType,
      termYears: si.termYears ?? null,
      measuringLife1Id: si.measuringLife1Id ?? null,
      measuringLife2Id: si.measuringLife2Id ?? null,
      charityId: si.charityId,
      originalIncomeInterest: interests.originalIncomeInterest.toString(),
      originalRemainderInterest: interests.originalRemainderInterest.toString(),
      updatedAt: new Date(),
    };

    if (existingSplitInterest) {
      await handle
        .update(trustSplitInterestDetails)
        .set(valuesToWrite)
        .where(eq(trustSplitInterestDetails.entityId, entityId));
    } else {
      await handle.insert(trustSplitInterestDetails).values(valuesToWrite);
    }

    // Auto-emit the remainder-interest gift only for new CLTs. CRTs never
    // emit a gift (income beneficiary = grantor / spouse). Existing CLTs
    // already filed this gift on the original §709 — delete the auto-emitted
    // row if origin was flipped to 'existing' to avoid double-counting.
    if (!isCrt) {
      if (isExisting) {
        await handle
          .delete(gifts)
          .where(
            and(
              eq(gifts.recipientEntityId, entityId),
              eq(gifts.eventKind, "clt_remainder_interest"),
            ),
          );
      } else {
        const remainderAmount = interests.originalRemainderInterest.toString();
        const noteText = `Auto-emitted at CLT '${updated.name}' inception. Remainder interest gift = ${interests.originalRemainderInterest}; income interest (charitable deduction) = ${interests.originalIncomeInterest}.`;
        const updatedGift = await handle
          .update(gifts)
          .set({
            year: si.inceptionYear,
            amount: remainderAmount,
            grantor,
            notes: noteText,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(gifts.recipientEntityId, entityId),
              eq(gifts.eventKind, "clt_remainder_interest"),
            ),
          )
          .returning({ id: gifts.id });

        if (updatedGift.length === 0) {
          await handle.insert(gifts).values({
            clientId: id,
            year: si.inceptionYear,
            amount: remainderAmount,
            grantor,
            recipientEntityId: entityId,
            eventKind: "clt_remainder_interest",
            enteredAsHistory: si.inceptionYear < currentPlanningYear(),
            notes: noteText,
          });
        }
      }
    }

    await recordAudit({
      action: "trust_split_interest.update",
      resourceType: "trust_split_interest_details",
      resourceId: entityId,
      clientId: id,
      firmId,
      metadata: {
        inceptionYear: si.inceptionYear,
        inceptionValue: si.inceptionValue,
        payoutPercent: si.payoutPercent,
        termType: si.termType,
        termYears: si.termYears,
        remainderFactor: interests.remainderFactor,
        originalIncomeInterest: interests.originalIncomeInterest,
        originalRemainderInterest: interests.originalRemainderInterest,
        ...crossFirmMeta,
      },
      actorId,
      tx: args.tx,
    });
  }

  await recordAudit({
    action: "entity.update",
    resourceType: "entity",
    resourceId: entityId,
    clientId: id,
    firmId,
    metadata: { name: updated.name, entityType: updated.entityType, ...crossFirmMeta },
    actorId,
    tx: args.tx,
  });

  const ownerRows = await handle
    .select()
    .from(entityOwners)
    .where(eq(entityOwners.entityId, entityId));
  const responseOwners = ownerRows.map((o) => ({
    kind: "family_member" as const,
    familyMemberId: o.familyMemberId,
    percent: parseFloat(o.percent),
  }));
  return { ok: true, data: { ...updated, owners: responseOwners }, resourceId: entityId };
}
