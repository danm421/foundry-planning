import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, familyMembers, accountOwners } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import {
  assertEntitiesInClient,
  assertModelPortfoliosInFirm,
  assertTickerPortfoliosInFirm,
} from "@/lib/db-scoping";
import { verifyClientAccess } from "@/lib/clients/authz";
import { recordUpdate, recordDelete } from "@/lib/audit";
import { pruneOrphanScenarioChanges } from "@/lib/scenario/prune-changes";
import { toAccountSnapshot, ACCOUNT_FIELD_LABELS } from "@/lib/audit/snapshots/account";
import {
  type ValidatedOwner,
  validateOwnersShape,
  validateOwnersTenant,
  validateAccountOwnershipRules,
} from "@/lib/ownership";
import { syncAccountFromHoldings } from "@/lib/investments/sync-account-from-holdings";

export const dynamic = "force-dynamic";

// PUT /api/clients/[id]/accounts/[accountId] — update account
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id, accountId } = await params;

    if (!(await verifyClientAccess(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await request.json();

    // Prevent mass-assignment: strip identity / tenancy fields so the row
     // can't be reparented or its id rewritten via request body.
    const {
      id: _stripId,
      clientId: _stripClientId,
      createdAt: _stripCreatedAt,
      updatedAt: _stripUpdatedAt,
      ...safeUpdate
    } = body;
    void _stripId; void _stripClientId;
    void _stripCreatedAt; void _stripUpdatedAt;

    // If the body attempts to set a cross-tenant FK, reject now. Without
     // these checks an attacker could use a legitimate PUT to swap a
     // victim's ownerEntity / modelPortfolio id in as a side effect.
    if ("ownerEntityId" in safeUpdate) {
      const c = await assertEntitiesInClient(id, [safeUpdate.ownerEntityId]);
      if (!c.ok) return NextResponse.json({ error: c.reason }, { status: 400 });
    }
    if ("modelPortfolioId" in safeUpdate) {
      const c = await assertModelPortfoliosInFirm(firmId, [safeUpdate.modelPortfolioId]);
      if (!c.ok) return NextResponse.json({ error: c.reason }, { status: 400 });
    }
    if ("tickerPortfolioId" in safeUpdate) {
      const c = await assertTickerPortfoliosInFirm(firmId, [safeUpdate.tickerPortfolioId]);
      if (!c.ok) return NextResponse.json({ error: c.reason }, { status: 400 });
    }

    const [before] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.clientId, id)));

    if (!before) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    // Default-checking accounts (the household's Household Cash and each
    // entity's internal cash) are system-managed. Reject mutations to
    // category / sub-type / parent (sub-account) / ownership — the engine
    // depends on the shape and these can't be changed via the dialog.
    if (before.isDefaultChecking) {
      if ("category" in safeUpdate && safeUpdate.category !== before.category) {
        return NextResponse.json(
          { error: "This is a system-managed cash account — its category can't be changed." },
          { status: 400 },
        );
      }
      if ("subType" in safeUpdate && safeUpdate.subType !== before.subType) {
        return NextResponse.json(
          { error: "This is a system-managed cash account — its account type can't be changed." },
          { status: 400 },
        );
      }
      // Reject any change to parentAccountId in either direction — including
      // "detach from business" (parentAccountId: null on an auto-provisioned
      // business cash) and "attach to business" (parentAccountId: <biz> on
      // household checking). The "parentAccountId" key has to be in the body
      // explicitly; PATCH-style omits leave the existing value alone.
      if (
        "parentAccountId" in body &&
        body.parentAccountId !== before.parentAccountId
      ) {
        return NextResponse.json(
          { error: "A system-managed cash account's parent can't be changed." },
          { status: 400 },
        );
      }
      if (Array.isArray(body.owners)) {
        return NextResponse.json(
          { error: "This is a system-managed cash account — its ownership can't be changed." },
          { status: 400 },
        );
      }
    }

    // ── owners[] validation (PUT) ──────────────────────────────────────────
    // When parentAccountId is being set non-null, the account becomes a child
    // of a business account. Children have no per-row owners — skip validation
    // entirely; the transaction will wipe accountOwners atomically.
    const isReparentingToParent = body.parentAccountId != null;
    let validatedOwners: ValidatedOwner[] | undefined;

    if (!isReparentingToParent && Array.isArray(body.owners)) {
      const shapeResult = validateOwnersShape(body.owners);
      if ("error" in shapeResult) {
        return NextResponse.json({ error: shapeResult.error }, { status: 400 });
      }

      // Resolve subType: use incoming value if provided, else existing row's value
      const resolvedSubType =
        "subType" in safeUpdate ? (safeUpdate as { subType?: string }).subType : before.subType;

      const rulesError = validateAccountOwnershipRules(
        shapeResult.owners,
        resolvedSubType,
        before.isDefaultChecking,
      );
      if (rulesError) {
        return NextResponse.json({ error: rulesError.error }, { status: 400 });
      }
      const tenantError = await validateOwnersTenant(shapeResult.owners, id);
      if (tenantError) {
        return NextResponse.json({ error: tenantError.error }, { status: 400 });
      }
      validatedOwners = shapeResult.owners;
    }
    // ── end owners[] validation ────────────────────────────────────────────

    // Strip owners from the account update payload — owners live in account_owners, not accounts
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { owners: _stripOwners, ...accountUpdate } = safeUpdate as Record<string, unknown>;

    let updated: typeof accounts.$inferSelect;
    await db.transaction(async (tx) => {
      const [result] = await tx
        .update(accounts)
        .set({
          ...accountUpdate,
          updatedAt: new Date(),
        })
        .where(and(eq(accounts.id, accountId), eq(accounts.clientId, id)))
        .returning();
      updated = result;

      if (isReparentingToParent) {
        // Child-of-business accounts carry no per-row owners — clear atomically.
        await tx.delete(accountOwners).where(eq(accountOwners.accountId, accountId));
      } else if (validatedOwners) {
        await tx.delete(accountOwners).where(eq(accountOwners.accountId, accountId));
        for (const o of validatedOwners) {
          await tx.insert(accountOwners).values({
            accountId,
            familyMemberId: o.kind === "family_member" ? o.familyMemberId : null,
            entityId: o.kind === "entity" ? o.entityId : null,
            percent: o.percent.toString(),
          });
        }
      }
    });

    if (!updated!) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    await recordUpdate({
      action: "account.update",
      resourceType: "account",
      resourceId: accountId,
      clientId: id,
      firmId,
      before: await toAccountSnapshot(before),
      after: await toAccountSnapshot(updated!),
      fieldLabels: ACCOUNT_FIELD_LABELS,
    });

    // Holdings-tab opt-in toggle: when an account is (re)enabled to derive from
    // its holdings, immediately roll them up into its asset mix.
    if (accountUpdate.deriveFromHoldings === true) {
      await syncAccountFromHoldings(accountId);
    }

    return NextResponse.json(updated!);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id]/accounts/[accountId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/clients/[id]/accounts/[accountId] — partial update
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id, accountId } = await params;

    if (!(await verifyClientAccess(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await request.json();
    const { ownerFamilyMemberId } = body;

    if (
      ownerFamilyMemberId !== undefined &&
      ownerFamilyMemberId !== null &&
      body.ownerEntityId
    ) {
      return NextResponse.json(
        { error: "Cannot set both ownerEntityId and ownerFamilyMemberId" },
        { status: 400 },
      );
    }

    // Tenant-isolation: verify the family_member belongs to this client, and
    // reject if the account already has an entity owner (owner precedence).
    if (ownerFamilyMemberId) {
      const [fm] = await db
        .select({ id: familyMembers.id })
        .from(familyMembers)
        .where(
          and(
            eq(familyMembers.id, ownerFamilyMemberId),
            eq(familyMembers.clientId, id),
          ),
        );
      if (!fm) {
        return NextResponse.json(
          { error: "Family member not found for this client" },
          { status: 400 },
        );
      }

      const [accountCheck] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.id, accountId), eq(accounts.clientId, id)));
      if (!accountCheck) {
        return NextResponse.json({ error: "Account not found" }, { status: 404 });
      }
      const entityOwnerRows = await db
        .select({ entityId: accountOwners.entityId })
        .from(accountOwners)
        .where(eq(accountOwners.accountId, accountId));
      const hasEntityOwner = entityOwnerRows.some((r) => r.entityId != null);
      if (hasEntityOwner) {
        return NextResponse.json(
          {
            error:
              "Cannot set ownerFamilyMemberId while the account has an entity owner. Clear entity ownership first.",
          },
          { status: 400 },
        );
      }
    }

    const [updated] = await db
      .update(accounts)
      .set({
        ...(ownerFamilyMemberId !== undefined
          ? { ownerFamilyMemberId: ownerFamilyMemberId || null }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(accounts.id, accountId), eq(accounts.clientId, id)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PATCH /api/clients/[id]/accounts/[accountId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/accounts/[accountId] — delete account
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id, accountId } = await params;

    if (!(await verifyClientAccess(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // Protect the default household cash account — it's required by the projection engine.
    const [target] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.clientId, id)));
    if (target?.isDefaultChecking) {
      return NextResponse.json(
        { error: "This is a system-managed cash account and can't be deleted." },
        { status: 400 }
      );
    }

    if (!target) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const snapshot = await toAccountSnapshot(target);

    await db.transaction(async (tx) => {
      await tx
        .delete(accounts)
        .where(and(eq(accounts.id, accountId), eq(accounts.clientId, id)));
      await pruneOrphanScenarioChanges(tx, accountId);
    });

    await recordDelete({
      action: "account.delete",
      resourceType: "account",
      resourceId: accountId,
      clientId: id,
      firmId,
      snapshot,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/accounts/[accountId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
