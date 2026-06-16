// Liability write-core. The single validation + write path shared by the API
// routes (src/app/api/clients/[id]/liabilities/**) and the Copilot write tools,
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
//   • IMPORTANT DIVERGENCE (route-equivalent on purpose): the live PUT route runs
//     NO FK tenancy asserts on update (no assertEntitiesInClient /
//     assertAccountsInClient), so this core omits them too to stay byte-for-byte
//     equivalent. This is a latent gap — a PUT/tool could set
//     linkedPropertyId/parentAccountId cross-tenant within the same firm. Tracked
//     in future-work/security-hardening.md; do NOT "fix" it here or Task 11's
//     route-equivalence assertions break.
import { db } from "@/db";
import { scenarios, liabilities, liabilityOwners, accounts } from "@/db/schema";
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
import { writeError, type EntityWriteResult } from "./entity-write-result";

type LiabilityRow = typeof liabilities.$inferSelect;

/**
 * Resolve the base-case scenario id for a client after verifying firm + staff
 * access. Mirrors the route's private `getBaseCaseScenarioId` (POST route) —
 * returns null when the client is inaccessible OR has no base case, which the
 * cores map to a 404 "Client not found" exactly like the route.
 */
async function baseCaseScenarioId(clientId: string, firmId: string): Promise<string | null> {
  if (!(await verifyClientAccess(clientId, firmId))) return null;

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));

  return scenario?.id ?? null;
}

export async function createLiabilityForClient(args: {
  clientId: string;
  firmId: string;
  actorId: string;
  input: unknown;
}): Promise<EntityWriteResult<LiabilityRow>> {
  const { clientId, firmId, actorId, input } = args;

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
  });

  return { ok: true, data: liability!, resourceId: liability!.id };
}

export async function updateLiabilityForClient(args: {
  clientId: string;
  firmId: string;
  actorId: string;
  liabilityId: string;
  input: unknown;
}): Promise<EntityWriteResult<LiabilityRow>> {
  const { clientId, firmId, actorId, liabilityId, input } = args;

  if (!(await verifyClientAccess(clientId, firmId))) {
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

  // ── owners[] validation (PUT) ──────────────────────────────────────────────
  // When parentAccountId is being set non-null the liability becomes a child of a
  // business account — children have no per-row owners, so skip validation and let
  // the transaction wipe liabilityOwners atomically.
  // NOTE: the live PUT route runs NO FK tenancy asserts here (see file header) —
  // this core omits them too to stay route-equivalent.
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
  });

  return { ok: true, data: updated!, resourceId: liabilityId };
}

export async function deleteLiabilityForClient(args: {
  clientId: string;
  firmId: string;
  actorId: string;
  liabilityId: string;
}): Promise<EntityWriteResult<{ id: string }>> {
  const { clientId, firmId, actorId, liabilityId } = args;

  if (!(await verifyClientAccess(clientId, firmId))) {
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
  });

  return { ok: true, data: { id: liabilityId }, resourceId: liabilityId };
}
