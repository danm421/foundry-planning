import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, accounts, familyMembers, accountOwners } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import {
  assertEntitiesInClient,
  assertModelPortfoliosInFirm,
} from "@/lib/db-scoping";
import { recordUpdate, recordDelete } from "@/lib/audit";
import { toAccountSnapshot, ACCOUNT_FIELD_LABELS } from "@/lib/audit/snapshots/account";
import {
  type ValidatedOwner,
  validateOwnersShape,
  validateOwnersTenant,
  validateAccountOwnershipRules,
} from "@/lib/ownership";

export const dynamic = "force-dynamic";

// PUT /api/clients/[id]/accounts/[accountId] — update account
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id, accountId } = await params;

    // Verify client belongs to this firm
    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

    if (!client) {
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

    const [before] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.clientId, id)));

    if (!before) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    // ── owners[] validation (PUT) ──────────────────────────────────────────
    let validatedOwners: ValidatedOwner[] | undefined;

    if (Array.isArray(body.owners)) {
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

      if (validatedOwners) {
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

    // Verify client belongs to this firm
    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

    if (!client) {
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

    // Verify client belongs to this firm
    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // Protect the default household cash account — it's required by the projection engine.
    const [target] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.clientId, id)));
    if (target?.isDefaultChecking) {
      return NextResponse.json(
        { error: "The default household cash account cannot be deleted." },
        { status: 400 }
      );
    }

    if (!target) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const snapshot = await toAccountSnapshot(target);

    await db
      .delete(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.clientId, id)));

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
