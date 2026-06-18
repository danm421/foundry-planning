// Liability write-core. The single validation + write path shared by the API
// routes (src/app/api/clients/[id]/liabilities/**) and the Forge write tools,
// so route and agent can never drift. Cloned from incomes-writes.ts — same
// baseCaseScenarioId helper, same writeError / {ok:true,...} shape.
//
// Lifted verbatim from the route bodies: base-case scenario lookup, schema parse,
// the entity / account FK asserts on CREATE, the parent-business check, the
// parent-vs-owners mutual-exclusion guard, the owners[] resolve/synthesis, the
// transactional insert/update/delete of the liabilities row + its liabilityOwners
// satellite, orphan-change prune, and the snapshot-based liability.{create,update,
// delete} audit. The only deltas vs the route: firmId/actorId are passed in (the
// route reads them from Clerk via requireOrgId()/auth()), and NextResponse.json(...)
// becomes writeError(...) / {ok:true,...}.
//
// Liability-specific notes (deltas vs expenses/incomes cores):
//   • Owners live in the liabilityOwners satellite table, NOT a column on
//     `liabilities` — so create/update wrap the row write + owner writes in a
//     single db.transaction.
//   • `ownerEntityId` is read from the schema (used by the entity FK assert and
//     legacy owner synthesis) but the `liabilities` table has NO owner_entity_id
//     column — so it is NOT written on insert/update (matches the live route,
//     which also never sets it).
//   • Snapshot-based audit (recordCreate/recordUpdate/recordDelete with
//     toLiabilitySnapshot + LIABILITY_FIELD_LABELS), not the metadata-only audit
//     the expense/income cores use.
//   • Parent-business check: a non-null parentAccountId must scope to the client
//     AND reference a category === "business" account.
//   • Parent-vs-owners mutual exclusion: a liability cannot have both a parent
//     business and explicit owners[].
//   • No isDefault guard on delete (liabilities have no default rows), but delete
//     DOES load + 404 the row first (unlike the income core's no-op delete).
//   • FK tenancy asserts on UPDATE (hardening, 2026-06-16): the update path
//     runs the same conditional FK asserts the CREATE core has — ownerEntityId
//     (assertEntitiesInClient), linkedPropertyId (assertAccountsInClient), and a
//     reparent parentAccountId (in-client + category === "business"). This
//     CLOSES a latent gap the original 1:1 port carried over from the live PUT
//     route, which ran no update-time asserts and so let a PUT/Forge tool set
//     linkedPropertyId/parentAccountId to a cross-client account in the same firm
//     (gateAccess only scopes to firm-owned clients, not the FK target's client).
//     The PUT route delegates to this core, so the route inherits the asserts and
//     route-equivalence is preserved by construction (route == core).
import { db } from "@/db";
import { liabilities, liabilityOwners, accounts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { verifyClientAccess } from "@/lib/clients/authz";
import { assertAccountsInClient, assertEntitiesInClient } from "@/lib/db-scoping";
import { recordCreate, recordUpdate, recordDelete } from "@/lib/audit";
import { toLiabilitySnapshot, LIABILITY_FIELD_LABELS } from "@/lib/audit/snapshots/liability";
import { pruneOrphanScenarioChanges } from "@/lib/scenario/prune-changes";
import { formatZodIssues } from "@/lib/schemas/common";
import {
  type ValidatedOwner,
  validateOwnersShape,
  validateOwnersTenant,
  synthesizeLegacyLiabilityOwners,
} from "@/lib/ownership";
import { liabilityCreateSchema, liabilityUpdateSchema } from "@/lib/schemas/liabilities";
import { baseCaseScenarioId } from "./base-case";
import { writeError, type EntityWriteResult } from "./entity-write-result";

type LiabilityRow = typeof liabilities.$inferSelect;

export async function createLiabilityForClient(args: {
  clientId: string;
  firmId: string;
  actorId: string;
  input: unknown;
  crossFirmMeta?: Record<string, unknown>;
}): Promise<EntityWriteResult<LiabilityRow>> {
  const { clientId, firmId, actorId, input, crossFirmMeta } = args;

  const scenarioId = await baseCaseScenarioId(clientId, firmId);
  if (!scenarioId) return writeError(404, "Client not found");

  const parsed = liabilityCreateSchema.safeParse(input);
  if (!parsed.success) {
    return writeError(400, formatZodIssues(parsed.error).map((i) => i.message).join("; "));
  }
  const p = parsed.data;

  const entCheck = await assertEntitiesInClient(clientId, [p.ownerEntityId]);
  if (!entCheck.ok) return writeError(400, entCheck.reason);

  // linkedPropertyId is an account id (real-estate account) — ensure it belongs
  // to this client before linking.
  const acctCheck = await assertAccountsInClient(clientId, [p.linkedPropertyId]);
  if (!acctCheck.ok) return writeError(400, acctCheck.reason);

  // parentAccountId (when set) must scope to this client AND point at a business
  // account — without this a crafted POST could attach to a non-business or
  // cross-firm parent.
  if (p.parentAccountId != null) {
    const parentCheck = await assertAccountsInClient(clientId, [p.parentAccountId]);
    if (!parentCheck.ok) return writeError(400, parentCheck.reason);
    const [parentRow] = await db
      .select({ category: accounts.category })
      .from(accounts)
      .where(eq(accounts.id, p.parentAccountId));
    if (!parentRow || parentRow.category !== "business") {
      return writeError(400, "parentAccountId must reference a business account");
    }
  }

  // ── owners[] validation ────────────────────────────────────────────────────
  let resolvedOwners: ValidatedOwner[] | undefined;

  if (p.parentAccountId != null) {
    // Children of a business inherit ownership via parentAccountId — skip both
    // the owners[] write and the legacy synthesis path.
    if (Array.isArray(p.owners) && p.owners.length > 0) {
      return writeError(400, "A liability cannot have both a parent business and explicit owners");
    }
    resolvedOwners = undefined;
  } else if (p.owners !== undefined) {
    // New owners[] path. (zod .optional() collapses absent → undefined, faithfully
    // reproducing the route's `"owners" in body && body.owners !== undefined`.)
    const shapeResult = validateOwnersShape(p.owners);
    if ("error" in shapeResult) return writeError(400, shapeResult.error);
    const tenantError = await validateOwnersTenant(shapeResult.owners, clientId);
    if (tenantError) return writeError(400, tenantError.error);
    resolvedOwners = shapeResult.owners;
  } else {
    // Legacy path: synthesize from ownerEntityId or client family member.
    const synthesized = await synthesizeLegacyLiabilityOwners(clientId, p.ownerEntityId);
    if (synthesized.length > 0) resolvedOwners = synthesized;
  }
  // ── end owners[] validation ────────────────────────────────────────────────

  // Insert values come straight off the parsed object — the schema already coerced
  // every field (decOrZero → "0"-defaulted strings, Number() → ints, termUnit →
  // "annual", balanceAsOf* / linkedPropertyId / parentAccountId / startYearRef →
  // null, isInterestDeductible → false). See src/lib/schemas/liabilities.ts.
  let liability: LiabilityRow;
  await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(liabilities)
      .values({
        clientId,
        scenarioId,
        name: p.name,
        balance: p.balance,
        interestRate: p.interestRate,
        monthlyPayment: p.monthlyPayment,
        startYear: p.startYear,
        startMonth: p.startMonth,
        termMonths: p.termMonths,
        termUnit: p.termUnit,
        balanceAsOfMonth: p.balanceAsOfMonth,
        balanceAsOfYear: p.balanceAsOfYear,
        linkedPropertyId: p.linkedPropertyId,
        startYearRef: p.startYearRef as LiabilityRow["startYearRef"],
        isInterestDeductible: p.isInterestDeductible,
        parentAccountId: p.parentAccountId,
      })
      .returning();
    liability = inserted;

    if (resolvedOwners && resolvedOwners.length > 0) {
      for (const o of resolvedOwners) {
        await tx.insert(liabilityOwners).values({
          liabilityId: liability.id,
          familyMemberId: o.kind === "family_member" ? o.familyMemberId : null,
          entityId: o.kind === "entity" ? o.entityId : null,
          percent: o.percent.toString(),
        });
      }
    }
  });

  await recordCreate({
    action: "liability.create",
    resourceType: "liability",
    resourceId: liability!.id,
    clientId,
    firmId,
    actorId,
    snapshot: await toLiabilitySnapshot(liability!),
    extraMetadata: crossFirmMeta,
  });

  return { ok: true, data: liability!, resourceId: liability!.id };
}

export async function updateLiabilityForClient(args: {
  clientId: string;
  firmId: string;
  actorId: string;
  liabilityId: string;
  input: unknown;
  crossFirmMeta?: Record<string, unknown>;
}): Promise<EntityWriteResult<LiabilityRow>> {
  const { clientId, firmId, actorId, liabilityId, input, crossFirmMeta } = args;

  const a = await verifyClientAccess(clientId);
  if (!a.ok || a.firmId !== firmId) {
    return writeError(404, "Client not found");
  }

  const parsed = liabilityUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return writeError(400, formatZodIssues(parsed.error).map((i) => i.message).join("; "));
  }
  const p = parsed.data;

  const [before] = await db
    .select()
    .from(liabilities)
    .where(and(eq(liabilities.id, liabilityId), eq(liabilities.clientId, clientId)));

  if (!before) return writeError(404, "Liability not found");

  // ── Cross-tenant FK asserts on the present keys ────────────────────────────
  // Validate any FK present in the update against this client — mirrors the CREATE
  // core and the income/expense update cores. Closes the cross-client gap noted in
  // the file header (gateAccess scopes only to firm-owned clients, not to the FK
  // target's client). The assert* helpers skip null/undefined ids, so an omitted or
  // explicitly-cleared field is a no-op.
  if (p.ownerEntityId !== undefined) {
    const c = await assertEntitiesInClient(clientId, [p.ownerEntityId]);
    if (!c.ok) return writeError(400, c.reason);
  }
  if (p.linkedPropertyId !== undefined) {
    const c = await assertAccountsInClient(clientId, [p.linkedPropertyId]);
    if (!c.ok) return writeError(400, c.reason);
  }
  // A non-null parentAccountId must scope to this client AND point at a business
  // account — identical to the CREATE core's parent-business check.
  if (p.parentAccountId != null) {
    const parentCheck = await assertAccountsInClient(clientId, [p.parentAccountId]);
    if (!parentCheck.ok) return writeError(400, parentCheck.reason);
    const [parentRow] = await db
      .select({ category: accounts.category })
      .from(accounts)
      .where(eq(accounts.id, p.parentAccountId));
    if (!parentRow || parentRow.category !== "business") {
      return writeError(400, "parentAccountId must reference a business account");
    }
  }
  // ── end FK asserts ──────────────────────────────────────────────────────────

  // ── owners[] validation (PUT) ──────────────────────────────────────────────
  // When parentAccountId is being set non-null the liability becomes a child of a
  // business account — children have no per-row owners, so skip validation and let
  // the transaction wipe liabilityOwners atomically.
  const isReparentingToParent = p.parentAccountId != null;
  let validatedOwners: ValidatedOwner[] | undefined;

  if (!isReparentingToParent && Array.isArray(p.owners)) {
    const shapeResult = validateOwnersShape(p.owners);
    if ("error" in shapeResult) return writeError(400, shapeResult.error);
    const tenantError = await validateOwnersTenant(shapeResult.owners, clientId);
    if (tenantError) return writeError(400, tenantError.error);
    validatedOwners = shapeResult.owners;
  }
  // ── end owners[] validation ────────────────────────────────────────────────

  // Conditional .set() — spread ONLY the present schema fields. owners are NOT a
  // column on `liabilities` (they live in liabilityOwners) so they're never set here.
  let updated: LiabilityRow;
  await db.transaction(async (tx) => {
    const [result] = await tx
      .update(liabilities)
      .set({
        ...(p.name !== undefined && { name: p.name }),
        ...(p.startYear !== undefined && { startYear: p.startYear }),
        ...(p.termMonths !== undefined && { termMonths: p.termMonths }),
        ...(p.balance !== undefined && { balance: p.balance }),
        ...(p.interestRate !== undefined && { interestRate: p.interestRate }),
        ...(p.monthlyPayment !== undefined && { monthlyPayment: p.monthlyPayment }),
        ...(p.startMonth !== undefined && { startMonth: p.startMonth }),
        ...(p.termUnit !== undefined && { termUnit: p.termUnit }),
        ...(p.balanceAsOfMonth !== undefined && { balanceAsOfMonth: p.balanceAsOfMonth }),
        ...(p.balanceAsOfYear !== undefined && { balanceAsOfYear: p.balanceAsOfYear }),
        ...(p.isInterestDeductible !== undefined && {
          isInterestDeductible: p.isInterestDeductible,
        }),
        ...(p.linkedPropertyId !== undefined && { linkedPropertyId: p.linkedPropertyId ?? null }),
        ...(p.parentAccountId !== undefined && { parentAccountId: p.parentAccountId ?? null }),
        ...(p.startYearRef !== undefined && {
          startYearRef: (p.startYearRef ?? null) as LiabilityRow["startYearRef"],
        }),
        updatedAt: new Date(),
      })
      .where(and(eq(liabilities.id, liabilityId), eq(liabilities.clientId, clientId)))
      .returning();
    updated = result;

    if (isReparentingToParent) {
      // Child-of-business liabilities carry no per-row owners — clear atomically.
      await tx.delete(liabilityOwners).where(eq(liabilityOwners.liabilityId, liabilityId));
    } else if (validatedOwners) {
      await tx.delete(liabilityOwners).where(eq(liabilityOwners.liabilityId, liabilityId));
      for (const o of validatedOwners) {
        await tx.insert(liabilityOwners).values({
          liabilityId,
          familyMemberId: o.kind === "family_member" ? o.familyMemberId : null,
          entityId: o.kind === "entity" ? o.entityId : null,
          percent: o.percent.toString(),
        });
      }
    }
  });

  if (!updated!) return writeError(404, "Liability not found");

  await recordUpdate({
    action: "liability.update",
    resourceType: "liability",
    resourceId: liabilityId,
    clientId,
    firmId,
    actorId,
    before: await toLiabilitySnapshot(before),
    after: await toLiabilitySnapshot(updated!),
    fieldLabels: LIABILITY_FIELD_LABELS,
    extraMetadata: crossFirmMeta,
  });

  return { ok: true, data: updated!, resourceId: liabilityId };
}

export async function deleteLiabilityForClient(args: {
  clientId: string;
  firmId: string;
  actorId: string;
  liabilityId: string;
  crossFirmMeta?: Record<string, unknown>;
}): Promise<EntityWriteResult<{ id: string }>> {
  const { clientId, firmId, actorId, liabilityId, crossFirmMeta } = args;

  const a = await verifyClientAccess(clientId);
  if (!a.ok || a.firmId !== firmId) {
    return writeError(404, "Client not found");
  }

  // Liabilities have no isDefault guard, but delete DOES load + 404 the row first
  // (unlike the income core's no-op delete) — keeps the snapshot audit faithful.
  const [existing] = await db
    .select()
    .from(liabilities)
    .where(and(eq(liabilities.id, liabilityId), eq(liabilities.clientId, clientId)));

  if (!existing) return writeError(404, "Liability not found");

  const snapshot = await toLiabilitySnapshot(existing);

  await db.transaction(async (tx) => {
    await tx
      .delete(liabilities)
      .where(and(eq(liabilities.id, liabilityId), eq(liabilities.clientId, clientId)));
    await pruneOrphanScenarioChanges(tx, liabilityId);
  });

  await recordDelete({
    action: "liability.delete",
    resourceType: "liability",
    resourceId: liabilityId,
    clientId,
    firmId,
    actorId,
    snapshot,
    extraMetadata: crossFirmMeta,
  });

  return { ok: true, data: { id: liabilityId }, resourceId: liabilityId };
}
