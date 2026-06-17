import { NextRequest, NextResponse } from "next/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { recordAudit } from "@/lib/audit";
import { db } from "@/db";
import { accountGroups } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import {
  updateAccountGroup,
  deleteAccountGroup,
  MemberValidationError,
  NameCollisionError,
  ReservedNameError,
  GroupNotFoundError,
} from "@/lib/account-groups/mutations";
import { updateAccountGroupSchema } from "@/lib/account-groups/schemas";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string; groupId: string }> };

async function verifyGroup(
  groupId: string,
  clientId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: accountGroups.id })
    .from(accountGroups)
    .where(and(eq(accountGroups.id, groupId), eq(accountGroups.clientId, clientId)));
  return !!row;
}

// PATCH /api/clients/[id]/account-groups/[groupId] — update a custom account group
export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  try {
    const { id: clientId, groupId } = await ctx.params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(clientId);
    await requireActiveSubscriptionForFirm(firmId);

    if (!(await verifyGroup(groupId, clientId))) {
      return NextResponse.json({ error: "Account group not found" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = updateAccountGroupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    await updateAccountGroup(clientId, groupId, parsed.data);

    await recordAudit({
      action: "account_group.update",
      resourceType: "account_group",
      resourceId: groupId,
      clientId,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { fields: Object.keys(parsed.data) }),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof GroupNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ReservedNameError || err instanceof NameCollisionError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof MemberValidationError) {
      return NextResponse.json(
        { error: err.message, reason: err.reason, accountIds: err.accountIds },
        { status: 422 },
      );
    }
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("PATCH /api/clients/[id]/account-groups/[groupId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/account-groups/[groupId] — delete a custom account group
export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
  try {
    const { id: clientId, groupId } = await ctx.params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(clientId);
    await requireActiveSubscriptionForFirm(firmId);

    if (!(await verifyGroup(groupId, clientId))) {
      return NextResponse.json({ error: "Account group not found" }, { status: 404 });
    }

    await deleteAccountGroup(clientId, groupId);

    await recordAudit({
      action: "account_group.delete",
      resourceType: "account_group",
      resourceId: groupId,
      clientId,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("DELETE /api/clients/[id]/account-groups/[groupId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
