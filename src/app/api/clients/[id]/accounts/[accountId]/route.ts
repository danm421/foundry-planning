import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, familyMembers, accountOwners } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import {
  updateAccountForClient,
  deleteAccountForClient,
} from "@/lib/clients/accounts-writes";

export const dynamic = "force-dynamic";

// PUT /api/clients/[id]/accounts/[accountId] — update account
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> }
) {
  try {
    const { id, accountId } = await params;
    const { userId, orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const result = await updateAccountForClient({
      clientId: id,
      firmId,
      actorId: userId,
      accountId,
      input: await request.json(),
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    return result.ok
      ? NextResponse.json(result.data)
      : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
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
    const { id, accountId } = await params;
    await requireOrgAndUser();
    const { firmId } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

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
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
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
    const { id, accountId } = await params;
    const { userId, orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const result = await deleteAccountForClient({
      clientId: id,
      firmId,
      actorId: userId,
      accountId,
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    return result.ok
      ? NextResponse.json({ success: true })
      : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/clients/[id]/accounts/[accountId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
