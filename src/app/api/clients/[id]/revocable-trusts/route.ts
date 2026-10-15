import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { revocableTrusts, accounts } from "@/db/schema";
import { eq, and, inArray, asc } from "drizzle-orm";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { createRevocableTrustForClient } from "@/lib/clients/revocable-trusts-writes";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const trusts = await db
      .select()
      .from(revocableTrusts)
      .where(eq(revocableTrusts.clientId, id))
      .orderBy(asc(revocableTrusts.name));

    const trustIds = trusts.map((t) => t.id);
    const taggedAccounts =
      trustIds.length > 0
        ? await db
            .select({ id: accounts.id, revocableTrustId: accounts.revocableTrustId })
            .from(accounts)
            .where(
              and(
                eq(accounts.clientId, id),
                inArray(accounts.revocableTrustId, trustIds)
              )
            )
        : [];

    const accountsByTrust = new Map<string, string[]>();
    for (const acct of taggedAccounts) {
      if (!acct.revocableTrustId) continue;
      const arr = accountsByTrust.get(acct.revocableTrustId) ?? [];
      arr.push(acct.id);
      accountsByTrust.set(acct.revocableTrustId, arr);
    }

    const enriched = trusts.map((t) => ({
      ...t,
      accountIds: accountsByTrust.get(t.id) ?? [],
    }));

    return NextResponse.json(enriched);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/revocable-trusts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const result = await createRevocableTrustForClient({
      clientId: id,
      firmId,
      input: await request.json(),
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    return result.ok
      ? NextResponse.json(result.data, { status: 201 })
      : NextResponse.json(result.body ?? { error: result.error }, { status: result.status });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/revocable-trusts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
