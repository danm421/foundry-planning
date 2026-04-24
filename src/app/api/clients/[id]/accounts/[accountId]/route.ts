import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, accounts, familyMembers } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import {
  assertEntitiesInClient,
  assertModelPortfoliosInFirm,
} from "@/lib/db-scoping";
import { recordAudit } from "@/lib/audit";

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

    const [updated] = await db
      .update(accounts)
      .set({
        ...safeUpdate,
        updatedAt: new Date(),
      })
      .where(and(eq(accounts.id, accountId), eq(accounts.clientId, id)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    await recordAudit({
      action: "account.update",
      resourceType: "account",
      resourceId: accountId,
      clientId: id,
      firmId,
      metadata: { name: updated.name, category: updated.category },
    });

    return NextResponse.json(updated);
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

      const [account] = await db
        .select({ ownerEntityId: accounts.ownerEntityId })
        .from(accounts)
        .where(and(eq(accounts.id, accountId), eq(accounts.clientId, id)));
      if (!account) {
        return NextResponse.json({ error: "Account not found" }, { status: 404 });
      }
      if (account.ownerEntityId) {
        return NextResponse.json(
          {
            error:
              "Cannot set ownerFamilyMemberId while the account has an entity owner. Clear ownerEntityId first.",
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

    await db
      .delete(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.clientId, id)));

    await recordAudit({
      action: "account.delete",
      resourceType: "account",
      resourceId: accountId,
      clientId: id,
      firmId,
      metadata: { name: target?.name ?? null },
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
