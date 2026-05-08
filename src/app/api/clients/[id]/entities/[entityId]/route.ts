import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  clients,
  entities,
  entityOwners,
  accounts,
  accountOwners,
  trustSplitInterestDetails,
  gifts,
  familyMembers,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { entityCreateSchema, entityUpdateSchema } from "@/lib/schemas/entities";
import type { TrustSubType } from "@/lib/entities/trust";
import { computeClutInceptionInterests } from "@/lib/entities/compute-clut-inception";
import type { TrustSplitInterestInput } from "@/lib/schemas/trust-split-interest";

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

export const dynamic = "force-dynamic";

async function verifyClient(clientId: string, firmId: string) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return !!client;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entityId: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id, entityId } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const [existing] = await db
      .select()
      .from(entities)
      .where(and(eq(entities.id, entityId), eq(entities.clientId, id)));
    if (!existing) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = entityUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const patch = parsed.data as {
      name?: string;
      entityType?: typeof existing.entityType;
      notes?: string | null;
      includeInPortfolio?: boolean;
      accessibleToClient?: boolean;
      isGrantor?: boolean;
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

    const householdMembers = await db
      .select({ id: familyMembers.id, role: familyMembers.role })
      .from(familyMembers)
      .where(eq(familyMembers.clientId, id));

    if (patch.owners) {
      const memberIds = new Set(householdMembers.map((m) => m.id));
      for (const o of patch.owners) {
        if (!memberIds.has(o.familyMemberId)) {
          return NextResponse.json(
            { error: `owners.familyMemberId ${o.familyMemberId} does not belong to this client` },
            { status: 400 },
          );
        }
      }
      if (patch.owners.length > 0) {
        const total = patch.owners.reduce((s, o) => s + o.percent, 0);
        if (Math.abs(total - 1) > 0.0001) {
          return NextResponse.json({ error: "owners percent must sum to 1.0" }, { status: 400 });
        }
      }
    }

    const effectiveType = patch.entityType ?? existing.entityType;
    const isBusinessType = !["trust", "foundation"].includes(effectiveType);
    const ownerEnumFromOwners =
      patch.owners !== undefined && isBusinessType
        ? deriveLegacyOwner(patch.owners, householdMembers)
        : undefined;

    // For CLUT entities, the merged-validation block below requires splitInterest
    // to be present (entityCreateSchema enforces this). Hydrate the existing row
    // so a non-splitInterest patch on a CLUT still validates.
    const [existingSplitInterest] = await db
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
      isGrantor: patch.isGrantor ?? existing.isGrantor,
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
      return NextResponse.json(
        { error: "Resulting entity would be invalid", issues: mergedCheck.error.issues },
        { status: 400 },
      );
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

    const [updated] = await db
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
        ...(patch.isGrantor !== undefined && {
          isGrantor: Boolean(patch.isGrantor),
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
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    // If owners were provided, replace the entity_owners set wholesale.
    // Skip for trust/foundation types — those don't use entity_owners.
    if (patch.owners !== undefined && isBusinessType) {
      await db.delete(entityOwners).where(eq(entityOwners.entityId, entityId));
      if (patch.owners.length > 0) {
        await db.insert(entityOwners).values(
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
      await db.delete(entityOwners).where(eq(entityOwners.entityId, entityId));
    }

    if (patch.splitInterest && updated.trustSubType === "clut") {
      const si = patch.splitInterest;
      const grantor = updated.grantor;
      if (grantor !== "client" && grantor !== "spouse") {
        return NextResponse.json(
          { error: "grantor ('client' or 'spouse') is required for CLUTs" },
          { status: 400 },
        );
      }

      const measuringLife1 = si.measuringLife1Id
        ? (await db
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
        ? (await db
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

      // For 'new' CLUTs we compute income/remainder from inputs; for
      // 'existing' the caller supplies historical values from the prior
      // return and we trust them (origin-aware branch).
      const isExistingClut = si.origin === "existing";
      const interests = isExistingClut
        ? {
            originalIncomeInterest: si.originalIncomeInterest!,
            originalRemainderInterest: si.originalRemainderInterest!,
            remainderFactor: undefined,
          }
        : computeClutInceptionInterests({
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
        await db
          .update(trustSplitInterestDetails)
          .set(valuesToWrite)
          .where(eq(trustSplitInterestDetails.entityId, entityId));
      } else {
        await db.insert(trustSplitInterestDetails).values(valuesToWrite);
      }

      // Auto-emit the remainder-interest gift only for new CLUTs. Existing
      // CLUTs already filed this gift on the original §709. If a previous
      // 'new'-mode save left an auto-emitted gift on this entity and the
      // user later flipped origin to 'existing', delete that ledger row to
      // avoid double-counting against the lifetime exemption.
      if (isExistingClut) {
        await db
          .delete(gifts)
          .where(
            and(
              eq(gifts.recipientEntityId, entityId),
              eq(gifts.eventKind, "clut_remainder_interest"),
            ),
          );
      } else {
        const remainderAmount = interests.originalRemainderInterest.toString();
        const noteText = `Auto-emitted at CLUT '${updated.name}' inception. Remainder interest gift = ${interests.originalRemainderInterest}; income interest (charitable deduction) = ${interests.originalIncomeInterest}.`;
        const updatedGift = await db
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
              eq(gifts.eventKind, "clut_remainder_interest"),
            ),
          )
          .returning({ id: gifts.id });

        if (updatedGift.length === 0) {
          await db.insert(gifts).values({
            clientId: id,
            year: si.inceptionYear,
            amount: remainderAmount,
            grantor,
            recipientEntityId: entityId,
            eventKind: "clut_remainder_interest",
            notes: noteText,
          });
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
        },
      });
    }

    await recordAudit({
      action: "entity.update",
      resourceType: "entity",
      resourceId: entityId,
      clientId: id,
      firmId,
      metadata: { name: updated.name, entityType: updated.entityType },
    });

    const ownerRows = await db
      .select()
      .from(entityOwners)
      .where(eq(entityOwners.entityId, entityId));
    const responseOwners = ownerRows.map((o) => ({
      kind: "family_member" as const,
      familyMemberId: o.familyMemberId,
      percent: parseFloat(o.percent),
    }));
    return NextResponse.json({ ...updated, owners: responseOwners });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id]/entities/[entityId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; entityId: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id, entityId } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // Delete the entity's default checking accounts explicitly. The accounts.owner_entity_id
    // FK is ON DELETE SET NULL, so other entity-owned accounts simply become household-
    // owned once the entity is gone — but a default checking whose owner_entity_id goes
    // Delete the entity's default checking account (if any). Previously keyed by
    // ownerEntityId; now find via account_owners junction table.
    // null would collide with the household's own default checking on the per-scenario
    // unique index.
    const entityDefaultCheckingOwnerRows = await db
      .select({ accountId: accountOwners.accountId })
      .from(accountOwners)
      .where(eq(accountOwners.entityId, entityId));
    const entityAccountIds = entityDefaultCheckingOwnerRows.map((r) => r.accountId);
    if (entityAccountIds.length > 0) {
      await db
        .delete(accounts)
        .where(
          and(
            eq(accounts.clientId, id),
            inArray(accounts.id, entityAccountIds),
            eq(accounts.isDefaultChecking, true)
          )
        );
    }

    await db
      .delete(entities)
      .where(and(eq(entities.id, entityId), eq(entities.clientId, id)));

    await recordAudit({
      action: "entity.delete",
      resourceType: "entity",
      resourceId: entityId,
      clientId: id,
      firmId,
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/entities/[entityId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
