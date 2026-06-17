import { NextRequest, NextResponse } from "next/server";
import { formatZodIssues } from "@/lib/schemas/common";
import { db } from "@/db";
import { revocableTrusts, accounts } from "@/db/schema";
import { eq, and, inArray, asc } from "drizzle-orm";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { revocableTrustUpsertSchema } from "@/lib/schemas/revocable-trusts";
import { verifyClientAccess } from "@/lib/clients/authz";

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
    const firmId = await requireOrgId();
    const { id } = await params;
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }

    const body = await request.json();
    const parsed = revocableTrustUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: formatZodIssues(parsed.error) },
        { status: 400 }
      );
    }
    const { name, accountIds } = parsed.data;

    const [trust] = await db
      .insert(revocableTrusts)
      .values({ clientId: id, name })
      .returning();

    // Tag the specified accounts into this trust (scope to clientId for safety)
    if (accountIds.length > 0) {
      await db
        .update(accounts)
        .set({ revocableTrustId: trust.id })
        .where(
          and(
            eq(accounts.clientId, id),
            inArray(accounts.id, accountIds)
          )
        );
    }

    await recordAudit({
      action: "revocable_trust.create",
      resourceType: "revocable_trust",
      resourceId: trust.id,
      clientId: id,
      firmId,
      metadata: { name: trust.name, accountIds },
    });

    return NextResponse.json({ ...trust, accountIds }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/revocable-trusts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
