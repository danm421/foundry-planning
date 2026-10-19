// Wills write core: the will create (POST /api/clients/[id]/wills) and the
// whole-replace update (PATCH …/wills/[willId]) moved out of their routes, plus
// the fact finder save's own writes, which touch one provision or the remaining
// estate's primary tier and never replace the will's other provisions.
//
// The two route writes are the route bodies verbatim: the route keeps its gates
// and its responses (`body` carries the route's `{ error, issues }` /
// `{ error, detail }`), and called without `tx` every statement runs as it did.
// With `tx` (D1), every read and write runs on it — the cross-ref checks too,
// so a provision can give an account or name a charity the same save created.
// Audit is metadata-style recordAudit, as the routes have it; without
// `actorId` it attributes the session's user, as the routes do.
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  entities,
  externalBeneficiaries,
  familyMembers,
  liabilities,
  liabilityOwners,
  willBequestRecipients,
  willBequests,
  willResiduaryRecipients,
  wills,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { handleOf, inTransaction, type DbOrTx, type Tx, type WriteOptions } from "@/lib/db-tx";
import { formatZodIssues } from "@/lib/schemas/common";
import {
  willBequestSchema,
  willCreateSchema,
  willUpdateSchema,
  type WillBequestInput,
  type WillCreateInput,
  type WillResiduaryRecipientInput,
  type WillUpdateInput,
} from "@/lib/schemas/wills";
import { writeError, type EntityWriteResult } from "./entity-write-result";

type CrossRefCheck = {
  accountIds: string[];
  familyMemberIds: string[];
  externalIds: string[];
  entityIds: string[];
  liabilityIds: string[];
};

export type CrossRefError = { code: string; detail?: string };

export function gatherCrossRefs(
  bequests: WillBequestInput[],
  residuary: WillResiduaryRecipientInput[] = [],
): CrossRefCheck {
  const check: CrossRefCheck = {
    accountIds: [],
    familyMemberIds: [],
    externalIds: [],
    entityIds: [],
    liabilityIds: [],
  };
  for (const b of bequests) {
    if (b.kind === "asset" && b.accountId) check.accountIds.push(b.accountId);
    if (b.kind === "asset" && b.entityId) check.entityIds.push(b.entityId);
    if (b.kind === "liability") check.liabilityIds.push(b.liabilityId);
    for (const r of b.recipients) {
      if (!r.recipientId) continue;
      if (r.recipientKind === "family_member") check.familyMemberIds.push(r.recipientId);
      else if (r.recipientKind === "external_beneficiary") check.externalIds.push(r.recipientId);
      else if (r.recipientKind === "entity") check.entityIds.push(r.recipientId);
    }
  }
  for (const r of residuary) {
    if (!r.recipientId) continue;
    if (r.recipientKind === "family_member") check.familyMemberIds.push(r.recipientId);
    else if (r.recipientKind === "external_beneficiary") check.externalIds.push(r.recipientId);
    else if (r.recipientKind === "entity") check.entityIds.push(r.recipientId);
  }
  return check;
}

export async function verifyCrossRefs(
  clientId: string,
  check: CrossRefCheck,
  bequests?: WillBequestInput[],
  handle: DbOrTx = db,
): Promise<CrossRefError | null> {
  if (check.accountIds.length > 0) {
    const rows = await handle
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.clientId, clientId), inArray(accounts.id, check.accountIds)));
    if (rows.length !== new Set(check.accountIds).size) {
      return { code: "One or more accountIds do not belong to this client" };
    }
  }
  if (check.familyMemberIds.length > 0) {
    const rows = await handle
      .select({ id: familyMembers.id })
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.clientId, clientId),
          inArray(familyMembers.id, check.familyMemberIds),
        ),
      );
    if (rows.length !== new Set(check.familyMemberIds).size) {
      return { code: "One or more family-member recipientIds do not belong to this client" };
    }
  }
  if (check.externalIds.length > 0) {
    const rows = await handle
      .select({ id: externalBeneficiaries.id })
      .from(externalBeneficiaries)
      .where(
        and(
          eq(externalBeneficiaries.clientId, clientId),
          inArray(externalBeneficiaries.id, check.externalIds),
        ),
      );
    if (rows.length !== new Set(check.externalIds).size) {
      return { code: "One or more external-beneficiary recipientIds do not belong to this client" };
    }
  }
  if (check.entityIds.length > 0) {
    const rows = await handle
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.clientId, clientId), inArray(entities.id, check.entityIds)));
    if (rows.length !== new Set(check.entityIds).size) {
      return { code: "One or more entity IDs (bequest or recipient) do not belong to this client" };
    }
  }

  // Liability-bequest cross-ref: batch-fetch all referenced liabilities in one
  // query (matches the account/family/entity pattern above), then validate each
  // in iteration order so error reporting is deterministic (first-bequest-first).
  if (bequests) {
    const liabilityIds = bequests
      .filter((b) => b.kind === "liability")
      .map((b) => b.liabilityId!);

    if (liabilityIds.length > 0) {
      const found = await handle
        .select({
          id: liabilities.id,
          linkedPropertyId: liabilities.linkedPropertyId,
        })
        .from(liabilities)
        .where(and(eq(liabilities.clientId, clientId), inArray(liabilities.id, liabilityIds)));

      // Check entity ownership via liability_owners junction.
      const ownerRows = await handle
        .select({ liabilityId: liabilityOwners.liabilityId, entityId: liabilityOwners.entityId })
        .from(liabilityOwners)
        .where(inArray(liabilityOwners.liabilityId, liabilityIds));
      const entityOwnedLiabIds = new Set(
        ownerRows.filter((r) => r.entityId != null).map((r) => r.liabilityId)
      );

      const byId = new Map(found.map((l) => [l.id, l]));

      for (const liabId of liabilityIds) {
        const liab = byId.get(liabId);
        if (!liab) {
          return { code: "liability_not_found", detail: liabId };
        }
        if (liab.linkedPropertyId != null) {
          return { code: "liability_linked_not_bequestable", detail: liab.id };
        }
        if (entityOwnedLiabIds.has(liab.id)) {
          return { code: "liability_entity_owned_not_bequestable", detail: liab.id };
        }
      }
    }
  }

  return null;
}

/** The will is this client's. */
export async function willBelongsToClient(willId: string, clientId: string, handle: DbOrTx = db): Promise<boolean> {
  const [row] = await handle
    .select({ id: wills.id })
    .from(wills)
    .where(and(eq(wills.id, willId), eq(wills.clientId, clientId)));
  return !!row;
}

/** One provision per debt per will (a partial unique index). */
const ONE_PER_DEBT = "will_bequests_liability_idx";

/**
 * The routes' check of a duplicate debt provision, as they have it: the code on
 * the error itself. Drizzle wraps every driver error (the code is on `cause`),
 * so against the live database it doesn't match — kept as is (D3).
 */
function routeDuplicateDebt(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("code" in err) || (err as { code: string }).code !== "23505") return false;
  return ((err as { constraint?: string }).constraint ?? "").includes(ONE_PER_DEBT);
}

/** The save's check: the driver's error, or the one Drizzle wraps it in. */
function duplicateDebt(err: unknown): boolean {
  return routeDuplicateDebt(err) || (typeof err === "object" && err !== null && routeDuplicateDebt((err as { cause?: unknown }).cause));
}

const DUPLICATE_DEBT = "duplicate_liability_bequest";

/** A provision's row, as both routes insert it. */
function bequestValues(willId: string, b: WillBequestInput, sortOrder: number) {
  return {
    willId,
    name: b.name,
    kind: b.kind,
    assetMode: b.kind === "asset" ? b.assetMode : null,
    accountId: b.kind === "asset" ? (b.accountId ?? null) : null,
    entityId: b.kind === "asset" ? (b.entityId ?? null) : null,
    liabilityId: b.kind === "liability" ? b.liabilityId : null,
    percentage: b.kind === "asset" ? String(b.percentage) : "100",
    condition: b.condition,
    sortOrder,
  };
}

async function insertRecipients(tx: Tx, bequestId: string, b: WillBequestInput): Promise<void> {
  if (b.recipients.length > 0) {
    await tx.insert(willBequestRecipients).values(
      b.recipients.map((r) => ({
        bequestId,
        recipientKind: r.recipientKind,
        recipientId: r.recipientId,
        percentage: String(r.percentage),
        sortOrder: r.sortOrder,
      })),
    );
  }
}

async function insertResiduary(tx: Tx, willId: string, rows: WillResiduaryRecipientInput[]): Promise<void> {
  await tx.insert(willResiduaryRecipients).values(
    rows.map((r) => ({
      willId,
      recipientKind: r.recipientKind,
      recipientId: r.recipientId,
      tier: r.tier,
      percentage: String(r.percentage),
      sortOrder: r.sortOrder,
    })),
  );
}

type RouteArgs = {
  clientId: string;
  firmId: string;
  /** Absent: the session's user, as the routes audit today. */
  actorId?: string;
  input: unknown;
  crossFirmMeta?: Record<string, unknown>;
} & WriteOptions;

const invalidBody = (error: Parameters<typeof formatZodIssues>[0]) =>
  writeError(400, "Invalid body", { error: "Invalid body", issues: formatZodIssues(error) });
const crossRefRefusal = (e: CrossRefError) => writeError(400, e.code, { error: e.code, detail: e.detail });

/** POST /wills: a will for one grantor, with its provisions and remaining estate. `data` is what was written; `resourceId` the will. */
export async function createWillForClient(args: RouteArgs): Promise<EntityWriteResult<WillCreateInput>> {
  const { clientId: id, firmId } = args;
  const handle = handleOf(args);
  const parsed = willCreateSchema.safeParse(args.input);
  if (!parsed.success) return invalidBody(parsed.error);
  const data = parsed.data;

  // Duplicate (client_id, grantor) check
  const [existing] = await handle
    .select({ id: wills.id })
    .from(wills)
    .where(and(eq(wills.clientId, id), eq(wills.grantor, data.grantor)));
  if (existing) {
    return writeError(409, `A will already exists for grantor='${data.grantor}'`);
  }

  const crossRefError = await verifyCrossRefs(
    id,
    gatherCrossRefs(data.bequests, data.residuaryRecipients),
    data.bequests,
    handle,
  );
  if (crossRefError) return crossRefRefusal(crossRefError);

  let willId: string;
  try {
    willId = await inTransaction(args, async (tx) => {
      const [willRow] = await tx
        .insert(wills)
        .values({ clientId: id, grantor: data.grantor })
        .returning();
      for (const b of data.bequests) {
        const [bequestRow] = await tx
          .insert(willBequests)
          .values(bequestValues(willRow.id, b, b.sortOrder))
          .returning();
        await insertRecipients(tx, bequestRow.id, b);
      }
      if (data.residuaryRecipients && data.residuaryRecipients.length > 0) {
        await insertResiduary(tx, willRow.id, data.residuaryRecipients);
      }
      return willRow.id;
    });
  } catch (err) {
    if (routeDuplicateDebt(err)) return writeError(400, DUPLICATE_DEBT);
    throw err;
  }

  await recordAudit({
    action: "will.create",
    resourceType: "will",
    resourceId: willId,
    clientId: id,
    firmId,
    actorId: args.actorId,
    metadata: { grantor: data.grantor, bequestCount: data.bequests.length, ...args.crossFirmMeta },
    tx: args.tx,
  });
  return { ok: true, data, resourceId: willId };
}

/** PATCH /wills/[willId]: replaces ALL the will's provisions and its remaining estate (absent → none). `resourceId` is the will. */
export async function updateWillForClient(args: RouteArgs & { willId: string }): Promise<EntityWriteResult<WillUpdateInput>> {
  const { clientId: id, firmId, willId } = args;
  const handle = handleOf(args);
  if (!(await willBelongsToClient(willId, id, handle))) {
    return writeError(404, "Will not found");
  }
  const parsed = willUpdateSchema.safeParse(args.input);
  if (!parsed.success) return invalidBody(parsed.error);
  const { bequests, residuaryRecipients } = parsed.data;

  const crossRefError = await verifyCrossRefs(
    id,
    gatherCrossRefs(bequests, residuaryRecipients),
    bequests,
    handle,
  );
  if (crossRefError) return crossRefRefusal(crossRefError);

  // Transactional full-replace: delete existing bequests (cascades to
  // recipients) and residuary, then re-insert.
  try {
    await inTransaction(args, async (tx) => {
      await tx.delete(willBequests).where(eq(willBequests.willId, willId));
      await tx
        .delete(willResiduaryRecipients)
        .where(eq(willResiduaryRecipients.willId, willId));
      for (const b of bequests) {
        const [bequestRow] = await tx
          .insert(willBequests)
          .values(bequestValues(willId, b, b.sortOrder))
          .returning();
        await insertRecipients(tx, bequestRow.id, b);
      }
      if (residuaryRecipients && residuaryRecipients.length > 0) {
        await insertResiduary(tx, willId, residuaryRecipients);
      }
      await tx
        .update(wills)
        .set({ updatedAt: new Date() })
        .where(eq(wills.id, willId));
    });
  } catch (err) {
    if (routeDuplicateDebt(err)) return writeError(400, DUPLICATE_DEBT);
    throw err;
  }

  await recordAudit({
    action: "will.update",
    resourceType: "will",
    resourceId: willId,
    clientId: id,
    firmId,
    actorId: args.actorId,
    metadata: { bequestCount: bequests.length, ...args.crossFirmMeta },
    tx: args.tx,
  });
  return { ok: true, data: parsed.data, resourceId: willId };
}

// ---- the fact finder save's own writes ------------------------------------------------------

type SaveArgs = { clientId: string; firmId: string; actorId: string; willId: string; input: unknown; crossFirmMeta?: Record<string, unknown> } & WriteOptions;

/** `will.update`, as the PATCH audits it: the will's provision count after the write. */
async function auditWillUpdate(args: SaveArgs, handle: DbOrTx): Promise<void> {
  const [{ n }] = await handle.select({ n: count() }).from(willBequests).where(eq(willBequests.willId, args.willId));
  await recordAudit({
    action: "will.update",
    resourceType: "will",
    resourceId: args.willId,
    clientId: args.clientId,
    firmId: args.firmId,
    actorId: args.actorId,
    metadata: { bequestCount: n, ...args.crossFirmMeta },
    tx: args.tx,
  });
}

/**
 * One new provision, after the will's provisions on record: its sort order is
 * one past the will's highest (the line's own `sortOrder` — its place among the
 * import's provisions — is kept by the save writing them in order).
 */
export async function addWillBequestForClient(args: SaveArgs): Promise<EntityWriteResult<{ id: string }>> {
  const handle = handleOf(args);
  if (!(await willBelongsToClient(args.willId, args.clientId, handle))) return writeError(404, "Will not found");
  const parsed = willBequestSchema.safeParse(args.input);
  if (!parsed.success) return invalidBody(parsed.error);
  const bequest = parsed.data;
  const crossRefError = await verifyCrossRefs(args.clientId, gatherCrossRefs([bequest]), [bequest], handle);
  if (crossRefError) return crossRefRefusal(crossRefError);

  const onRecord = await handle.select({ sortOrder: willBequests.sortOrder }).from(willBequests).where(eq(willBequests.willId, args.willId));
  const sortOrder = onRecord.reduce((next, b) => Math.max(next, b.sortOrder + 1), 0);
  let id: string;
  try {
    id = await inTransaction(args, async (tx) => {
      const [row] = await tx.insert(willBequests).values(bequestValues(args.willId, bequest, sortOrder)).returning({ id: willBequests.id });
      await insertRecipients(tx, row.id, bequest);
      await tx.update(wills).set({ updatedAt: new Date() }).where(eq(wills.id, args.willId));
      return row.id;
    });
  } catch (err) {
    if (duplicateDebt(err)) return writeError(400, DUPLICATE_DEBT);
    throw err;
  }
  await auditWillUpdate(args, handle);
  return { ok: true, data: { id }, resourceId: id };
}

/**
 * One provision on record, in place (its id, name and sort order kept): the
 * input's keys over the record's, checked as a whole provision. Its recipients
 * are replaced only when the input names them.
 */
export async function updateWillBequestForClient(args: SaveArgs & { bequestId: string }): Promise<EntityWriteResult<{ id: string }>> {
  const handle = handleOf(args);
  if (!(await willBelongsToClient(args.willId, args.clientId, handle))) return writeError(404, "Will not found");
  const [before] = await handle
    .select()
    .from(willBequests)
    .where(and(eq(willBequests.id, args.bequestId), eq(willBequests.willId, args.willId)));
  if (!before) return writeError(404, "Will provision not found");
  const patch = args.input;
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return writeError(400, "Invalid body");
  const recipients = await handle
    .select()
    .from(willBequestRecipients)
    .where(eq(willBequestRecipients.bequestId, before.id))
    .orderBy(asc(willBequestRecipients.sortOrder));

  const parsed = willBequestSchema.safeParse({
    kind: before.kind,
    name: before.name,
    assetMode: before.assetMode,
    accountId: before.accountId,
    entityId: before.entityId,
    liabilityId: before.liabilityId,
    percentage: Number(before.percentage),
    condition: before.condition,
    sortOrder: before.sortOrder,
    recipients: recipients.map((r) => ({ recipientKind: r.recipientKind, recipientId: r.recipientId, percentage: Number(r.percentage), sortOrder: r.sortOrder })),
    ...patch,
  });
  if (!parsed.success) return invalidBody(parsed.error);
  const bequest = parsed.data;
  const crossRefError = await verifyCrossRefs(args.clientId, gatherCrossRefs([bequest]), [bequest], handle);
  if (crossRefError) return crossRefRefusal(crossRefError);

  try {
    await inTransaction(args, async (tx) => {
      await tx
        .update(willBequests)
        .set({ ...bequestValues(args.willId, bequest, before.sortOrder), updatedAt: new Date() })
        .where(eq(willBequests.id, before.id));
      if ("recipients" in patch) {
        await tx.delete(willBequestRecipients).where(eq(willBequestRecipients.bequestId, before.id));
        await insertRecipients(tx, before.id, bequest);
      }
      await tx.update(wills).set({ updatedAt: new Date() }).where(eq(wills.id, args.willId));
    });
  } catch (err) {
    if (duplicateDebt(err)) return writeError(400, DUPLICATE_DEBT);
    throw err;
  }
  await auditWillUpdate(args, handle);
  return { ok: true, data: { id: before.id }, resourceId: before.id };
}

/**
 * Who receives the rest of the estate: replaces the will's PRIMARY tier with
 * `input.residuaryRecipients` (checked as the PATCH checks them) and keeps its
 * contingent tier. Never empties it.
 */
export async function replaceWillResiduaryForClient(args: SaveArgs): Promise<EntityWriteResult<{ id: string }>> {
  const handle = handleOf(args);
  if (!(await willBelongsToClient(args.willId, args.clientId, handle))) return writeError(404, "Will not found");
  const parsed = willUpdateSchema.safeParse({ residuaryRecipients: (args.input as { residuaryRecipients?: unknown } | null)?.residuaryRecipients });
  if (!parsed.success) return invalidBody(parsed.error);
  const rows = parsed.data.residuaryRecipients ?? [];
  if (rows.length === 0) return writeError(400, "Name who receives the remaining estate.");
  if (rows.some((r) => r.tier !== "primary")) return writeError(400, "Only the primary tier of the remaining estate is replaced here.");
  const crossRefError = await verifyCrossRefs(args.clientId, gatherCrossRefs([], rows), undefined, handle);
  if (crossRefError) return crossRefRefusal(crossRefError);

  await inTransaction(args, async (tx) => {
    await tx
      .delete(willResiduaryRecipients)
      .where(and(eq(willResiduaryRecipients.willId, args.willId), eq(willResiduaryRecipients.tier, "primary")));
    await insertResiduary(tx, args.willId, rows);
    await tx.update(wills).set({ updatedAt: new Date() }).where(eq(wills.id, args.willId));
  });
  await auditWillUpdate(args, handle);
  return { ok: true, data: { id: args.willId }, resourceId: args.willId };
}
