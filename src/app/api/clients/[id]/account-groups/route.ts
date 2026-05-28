import { NextRequest, NextResponse } from "next/server";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse } from "@/lib/authz";
import { findClientInFirm } from "@/lib/db-scoping";
import { recordAudit } from "@/lib/audit";
import { listAccountGroups } from "@/lib/account-groups/queries";
import {
  createAccountGroup,
  MemberValidationError,
  NameCollisionError,
  ReservedNameError,
} from "@/lib/account-groups/mutations";
import { createAccountGroupSchema } from "@/lib/account-groups/schemas";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

// GET /api/clients/[id]/account-groups — list all custom account groups
export async function GET(_req: NextRequest, ctx: RouteCtx) {
  try {
    const firmId = await requireOrgId();
    const { id: clientId } = await ctx.params;

    if (!(await findClientInFirm(clientId, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const groups = await listAccountGroups(clientId);
    return NextResponse.json(groups);
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("GET /api/clients/[id]/account-groups error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients/[id]/account-groups — create a custom account group
export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const firmId = await requireOrgId();
    const { id: clientId } = await ctx.params;

    if (!(await findClientInFirm(clientId, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = createAccountGroupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { id: groupId } = await createAccountGroup(clientId, parsed.data);

    await recordAudit({
      action: "account_group.create",
      resourceType: "account_group",
      resourceId: groupId,
      clientId,
      firmId,
      metadata: {
        name: parsed.data.name,
        memberCount: parsed.data.memberAccountIds.length,
      },
    });

    return NextResponse.json({ id: groupId }, { status: 201 });
  } catch (err) {
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
    console.error("POST /api/clients/[id]/account-groups error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
