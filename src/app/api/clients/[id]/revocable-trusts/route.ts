import { NextRequest, NextResponse } from "next/server";
import { formatZodIssues } from "@/lib/schemas/common";
import { db } from "@/db";
import { clients, revocableTrusts, accounts } from "@/db/schema";
import { eq, and, inArray, asc } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { revocableTrustUpsertSchema } from "@/lib/schemas/revocable-trusts";

export const dynamic = "force-dynamic";

async function verifyClient(clientId: string, firmId: string): Promise<boolean> {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return !!client;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;
    if (!(await verifyClient(id, firmId))) {
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
    if (err instanceof Error && err.message.includes("Unauthorized")) {
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
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
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
    if (err instanceof Error && err.message.includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/revocable-trusts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
