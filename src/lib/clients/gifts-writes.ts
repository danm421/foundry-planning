// Gift write-core: POST /gifts and PATCH /gifts/[giftId] moved out of their routes
// verbatim, so the fact finder save can write a prior gift on its transaction.
// The routes keep their gates and answer `result.body ?? { error: result.error }`.
// With a save's `tx` every statement runs on it (a trust, charity or family member
// created earlier in the save is found); without, today's statements on module `db`.
import { gifts, liabilities, accounts, entities, familyMembers, externalBeneficiaries } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { formatZodIssues } from "@/lib/schemas/common";
import { handleOf, inTransaction, type WriteOptions } from "@/lib/db-tx";
import { assertAccountsInClient, assertLiabilitiesInClient } from "@/lib/db-scoping";
import { recordAudit } from "@/lib/audit";
import { giftCreateSchema, giftUpdateSchema } from "@/lib/schemas/gifts";
import { checkQcdSource, checkMergedQcd } from "@/lib/gifts/qcd-source-check";
import { applyOwnershipTransfer, getProjectionStartYearForScenario, OwnershipTransferError } from "@/lib/ownership";
import { buildBundledChildValues, buildChildPatchValues } from "@/lib/clients/gift-child-values";
import { writeError, type EntityWriteResult } from "./entity-write-result";

export type GiftRow = typeof gifts.$inferSelect;

export async function createGiftForClient(
  args: {
    clientId: string;
    firmId: string;
    actorId?: string;
    input: unknown;
    crossFirmMeta?: Record<string, unknown>;
  } & WriteOptions,
): Promise<EntityWriteResult<GiftRow>> {
  const { clientId: id, firmId, actorId, input, crossFirmMeta } = args;
  const handle = handleOf(args);
  const parsed = giftCreateSchema.safeParse(input);
  if (!parsed.success) {
    const issues = formatZodIssues(parsed.error);
    return writeError(400, "Invalid body", { error: "Invalid body", issues });
  }
  const data = parsed.data;

  if (data.eventKind && data.eventKind !== "outright") {
    return writeError(
      400,
      "eventKind must be 'outright' on user-created gifts; engine-emitted kinds are reserved.",
    );
  }

  if (data.recipientEntityId) {
    const [entity] = await handle
      .select({
        id: entities.id,
        entityType: entities.entityType,
        isIrrevocable: entities.isIrrevocable,
      })
      .from(entities)
      .where(and(eq(entities.id, data.recipientEntityId), eq(entities.clientId, id)));
    if (!entity) return writeError(400, "Recipient entity not found for this client");
    if (entity.entityType !== "trust") {
      return writeError(
        400,
        "Recipient must be a trust (gifts to LLCs / foundations / etc. are not supported)",
      );
    }
    if (!entity.isIrrevocable) {
      return writeError(400, "Gifts to revocable trusts are not completed gifts; no exemption is used");
    }
  }
  if (data.recipientFamilyMemberId) {
    const [fm] = await handle
      .select({ id: familyMembers.id })
      .from(familyMembers)
      .where(and(eq(familyMembers.id, data.recipientFamilyMemberId), eq(familyMembers.clientId, id)));
    if (!fm) return writeError(400, "Recipient family member not found for this client");
  }
  if (data.recipientExternalBeneficiaryId) {
    const [ext] = await handle
      .select({ id: externalBeneficiaries.id })
      .from(externalBeneficiaries)
      .where(
        and(
          eq(externalBeneficiaries.id, data.recipientExternalBeneficiaryId),
          eq(externalBeneficiaries.clientId, id),
        ),
      );
    if (!ext) return writeError(400, "Recipient external beneficiary not found for this client");
  }

  // Cross-tenant FK guard: accountId/liabilityId come straight from the body
  // and feed bare-id lookups + the destructive applyOwnershipTransfer dual-write.
  // Without these, a caller could transfer another firm's account/liability
  // ownership (audit F1). Validate they belong to this client before any use.
  const acctCheck = await assertAccountsInClient(id, [data.accountId], args.tx);
  if (!acctCheck.ok) return writeError(400, acctCheck.reason);
  const liabCheck = await assertLiabilitiesInClient(id, [data.liabilityId], args.tx);
  if (!liabCheck.ok) return writeError(400, liabCheck.reason);

  // A QCD's IRA and charity must be ones the IRS allows (the schema only checks shape).
  if (data.qcdAccountId != null && data.recipientExternalBeneficiaryId != null) {
    const qcdError = await checkQcdSource(handle, id, {
      qcdAccountId: data.qcdAccountId,
      recipientExternalBeneficiaryId: data.recipientExternalBeneficiaryId,
      grantor: data.grantor,
    });
    if (qcdError) return writeError(400, qcdError);
  }

  let row: GiftRow;
  try {
    row = await inTransaction(args, async (tx) => {
      const [parent] = await tx
        .insert(gifts)
        .values({
          clientId: id,
          year: data.year,
          yearRef: data.yearRef ?? null,
          // amount is only valid for cash gifts; null for asset/liability transfers
          amount: data.accountId == null && data.liabilityId == null
            ? (data.amount != null ? String(data.amount) : null)
            : null,
          grantor: data.grantor,
          recipientEntityId: data.recipientEntityId ?? null,
          recipientFamilyMemberId: data.recipientFamilyMemberId ?? null,
          recipientExternalBeneficiaryId: data.recipientExternalBeneficiaryId ?? null,
          accountId: data.accountId ?? null,
          liabilityId: data.liabilityId ?? null,
          percent: data.percent != null ? String(data.percent) : null,
          valuationDiscount:
            data.valuationDiscount != null ? String(data.valuationDiscount) : null,
          parentGiftId: null,
          useCrummeyPowers: data.useCrummeyPowers ?? false,
          notes: data.notes ?? null,
          qcdAccountId: data.qcdAccountId ?? null,
          qcdAmountMode: data.qcdAmountMode ?? null,
        })
        .returning();

      // If this is an asset transfer (accountId set, no explicit liabilityId),
      // check for a linked liability and auto-create a bundled child gift row.
      let linkedLiabilityId: string | null = null;
      if (data.accountId != null && data.liabilityId == null) {
        const linked = await tx.query.liabilities.findFirst({
          where: and(
            eq(liabilities.linkedPropertyId, data.accountId),
            eq(liabilities.clientId, id),
          ),
        });
        if (linked) {
          linkedLiabilityId = linked.id;
          await tx.insert(gifts).values(
            buildBundledChildValues({
              clientId: id,
              year: data.year,
              yearRef: data.yearRef ?? null,
              grantor: data.grantor,
              accountId: data.accountId,
              linkedLiabilityId: linked.id,
              percent: data.percent ?? null,
              parentGiftId: parent.id,
              recipientEntityId: data.recipientEntityId ?? null,
              recipientFamilyMemberId: data.recipientFamilyMemberId ?? null,
              recipientExternalBeneficiaryId:
                data.recipientExternalBeneficiaryId ?? null,
            }),
          );
        }
      }

      // ── Past-dated dual-write to junction tables ──────────────────────────
      // For transfers where year < projectionStartYear, the engine won't replay
      // the event at projection time, so we must persist the post-transfer
      // ownership state in account_owners / liability_owners right now.
      // For future-dated transfers (year >= projectionStartYear) the engine fans
      // the event dynamically — junction tables stay untouched.
      //
      // Only fires for asset/liability transfers to a recipient entity (not cash gifts).
      if (
        data.recipientEntityId != null &&
        data.percent != null &&
        (data.accountId != null || data.liabilityId != null || linkedLiabilityId != null)
      ) {
        // Resolve the scenario from the account or liability being transferred.
        let scenarioId: string | null = null;
        if (data.accountId != null) {
          const [acctRow] = await tx
            .select({ scenarioId: accounts.scenarioId })
            .from(accounts)
            .where(eq(accounts.id, data.accountId));
          scenarioId = acctRow?.scenarioId ?? null;
        } else if (data.liabilityId != null) {
          const [liabRow] = await tx
            .select({ scenarioId: liabilities.scenarioId })
            .from(liabilities)
            .where(eq(liabilities.id, data.liabilityId));
          scenarioId = liabRow?.scenarioId ?? null;
        }

        if (scenarioId != null) {
          const projectionStartYear = await getProjectionStartYearForScenario(tx, scenarioId);
          // If no plan_settings row exists yet, skip the dual-write entirely.
          if (projectionStartYear != null && data.year < projectionStartYear) {
            if (data.accountId != null) {
              await applyOwnershipTransfer(tx, "account", data.accountId, data.percent, data.recipientEntityId);
            }

            if (data.liabilityId != null) {
              await applyOwnershipTransfer(tx, "liability", data.liabilityId, data.percent, data.recipientEntityId);
            }

            if (linkedLiabilityId != null) {
              await applyOwnershipTransfer(tx, "liability", linkedLiabilityId, data.percent, data.recipientEntityId);
            }
          }
        }
      }
      // ── end past-dated dual-write ─────────────────────────────────────────

      return parent;
    });
  } catch (err) {
    if (err instanceof OwnershipTransferError) return writeError(400, err.message);
    throw err;
  }
  await recordAudit({
    action: "gift.create",
    resourceType: "gift",
    resourceId: row.id,
    clientId: id,
    firmId,
    actorId,
    metadata: {
      year: row.year,
      grantor: row.grantor,
      accountId: row.accountId,
      liabilityId: row.liabilityId,
      qcdAccountId: row.qcdAccountId,
      ...crossFirmMeta,
    },
    tx: args.tx,
  });
  return { ok: true, data: row, resourceId: row.id };
}

export async function updateGiftForClient(
  args: {
    clientId: string;
    firmId: string;
    actorId?: string;
    giftId: string;
    input: unknown;
    crossFirmMeta?: Record<string, unknown>;
  } & WriteOptions,
): Promise<EntityWriteResult<GiftRow>> {
  const { clientId: id, firmId, actorId, giftId, input, crossFirmMeta } = args;
  const handle = handleOf(args);
  const parsed = giftUpdateSchema.safeParse(input);
  if (!parsed.success) {
    const issues = formatZodIssues(parsed.error);
    return writeError(400, "Invalid body", { error: "Invalid body", issues });
  }
  const patch = parsed.data as {
    year?: number;
    amount?: number;
    percent?: number | null;
    valuationDiscount?: number | null;
    grantor?: "client" | "spouse" | "joint";
    recipientEntityId?: string | null;
    recipientFamilyMemberId?: string | null;
    recipientExternalBeneficiaryId?: string | null;
    useCrummeyPowers?: boolean;
    notes?: string | null;
    qcdAccountId?: string | null;
    qcdAmountMode?: "fixed" | "full_rmd" | null;
  };

  if (patch.recipientEntityId) {
    const [entity] = await handle
      .select({
        id: entities.id,
        entityType: entities.entityType,
        isIrrevocable: entities.isIrrevocable,
      })
      .from(entities)
      .where(and(eq(entities.id, patch.recipientEntityId), eq(entities.clientId, id)));
    if (!entity) return writeError(400, "Recipient entity not found for this client");
    if (entity.entityType !== "trust") return writeError(400, "Recipient must be a trust");
    if (!entity.isIrrevocable) {
      return writeError(400, "Gifts to revocable trusts are not completed gifts");
    }
  }
  if (patch.recipientFamilyMemberId) {
    const [fm] = await handle
      .select({ id: familyMembers.id })
      .from(familyMembers)
      .where(and(eq(familyMembers.id, patch.recipientFamilyMemberId), eq(familyMembers.clientId, id)));
    if (!fm) return writeError(400, "Recipient family member not found for this client");
  }
  if (patch.recipientExternalBeneficiaryId) {
    const [ext] = await handle
      .select({ id: externalBeneficiaries.id })
      .from(externalBeneficiaries)
      .where(
        and(
          eq(externalBeneficiaries.id, patch.recipientExternalBeneficiaryId),
          eq(externalBeneficiaries.clientId, id),
        ),
      );
    if (!ext) return writeError(400, "Recipient external beneficiary not found for this client");
  }

  // PATCH bodies are partial, so a QCD is validated against the stored row with
  // the patch laid over it: a grantor- or recipient-only edit could otherwise
  // move a QCD to the other spouse's IRA or a private charity. One extra SELECT,
  // and only when the patch touches a field a QCD rule reads.
  const touchesQcdRule =
    patch.qcdAccountId !== undefined ||
    patch.qcdAmountMode !== undefined ||
    patch.grantor !== undefined ||
    patch.recipientEntityId !== undefined ||
    patch.recipientFamilyMemberId !== undefined ||
    patch.recipientExternalBeneficiaryId !== undefined ||
    patch.amount !== undefined;
  if (touchesQcdRule) {
    const [existing] = await handle
      .select()
      .from(gifts)
      .where(and(eq(gifts.id, giftId), eq(gifts.clientId, id)));
    if (existing) {
      const touchedRecipient =
        patch.recipientEntityId !== undefined ||
        patch.recipientFamilyMemberId !== undefined ||
        patch.recipientExternalBeneficiaryId !== undefined;
      const merged = {
        qcdAccountId:
          patch.qcdAccountId !== undefined ? patch.qcdAccountId : existing.qcdAccountId,
        qcdAmountMode:
          patch.qcdAmountMode !== undefined ? patch.qcdAmountMode : existing.qcdAmountMode,
        grantor: patch.grantor ?? existing.grantor,
        recipientExternalBeneficiaryId: touchedRecipient
          ? (patch.recipientExternalBeneficiaryId ?? null)
          : existing.recipientExternalBeneficiaryId,
        amount:
          patch.amount !== undefined
            ? patch.amount
            : existing.amount != null
              ? Number(existing.amount)
              : null,
        transfersAsset:
          existing.accountId != null ||
          existing.liabilityId != null ||
          existing.businessEntityId != null,
      };
      const qcdError = await checkMergedQcd(handle, id, merged);
      if (qcdError) return writeError(400, qcdError);
      // The schema lets a patch carry amount 0 (a full-RMD QCD stores 0); a row
      // that is not a QCD must still be a positive cash gift.
      if (
        merged.qcdAccountId == null &&
        !merged.transfersAsset &&
        merged.amount != null &&
        merged.amount <= 0
      ) {
        return writeError(400, "amount must be greater than zero.");
      }
    }
  }

  const row = await inTransaction(args, async (tx) => {
    const [updated] = await tx
      .update(gifts)
      .set({
        ...(patch.year !== undefined && { year: patch.year }),
        ...(patch.amount !== undefined && { amount: String(patch.amount) }),
        ...(patch.percent !== undefined && {
          percent: patch.percent != null ? String(patch.percent) : null,
        }),
        ...(patch.valuationDiscount !== undefined && {
          valuationDiscount:
            patch.valuationDiscount != null ? String(patch.valuationDiscount) : null,
        }),
        ...(patch.grantor !== undefined && { grantor: patch.grantor }),
        ...(patch.recipientEntityId !== undefined && {
          recipientEntityId: patch.recipientEntityId ?? null,
        }),
        ...(patch.recipientFamilyMemberId !== undefined && {
          recipientFamilyMemberId: patch.recipientFamilyMemberId ?? null,
        }),
        ...(patch.recipientExternalBeneficiaryId !== undefined && {
          recipientExternalBeneficiaryId:
            patch.recipientExternalBeneficiaryId ?? null,
        }),
        ...(patch.useCrummeyPowers !== undefined && {
          useCrummeyPowers: patch.useCrummeyPowers,
        }),
        ...(patch.notes !== undefined && { notes: patch.notes ?? null }),
        ...(patch.qcdAccountId !== undefined && { qcdAccountId: patch.qcdAccountId }),
        ...(patch.qcdAmountMode !== undefined && { qcdAmountMode: patch.qcdAmountMode }),
        updatedAt: new Date(),
      })
      .where(and(eq(gifts.id, giftId), eq(gifts.clientId, id)))
      .returning();

    if (!updated) return undefined;

    // Propagate to bundled children. `percent` AND the recipient columns —
    // a parent that moves from a trust to a person leaves the child pointing
    // at a stale `recipientEntityId` otherwise, and the child then fans a
    // liability transfer to a party the parent no longer names.
    if (updated.parentGiftId === null) {
      const childPatch = buildChildPatchValues(patch);
      if (childPatch) {
        await tx
          .update(gifts)
          .set({ ...childPatch, updatedAt: new Date() })
          .where(eq(gifts.parentGiftId, giftId));
      }
    }

    return updated;
  });

  if (!row) return writeError(404, "Gift not found");
  await recordAudit({
    action: "gift.update",
    resourceType: "gift",
    resourceId: giftId,
    clientId: id,
    firmId,
    actorId,
    metadata: { qcdAccountId: row.qcdAccountId, ...crossFirmMeta },
    tx: args.tx,
  });
  return { ok: true, data: row, resourceId: giftId };
}
