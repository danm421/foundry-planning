import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accountAssetAllocations, assetClasses, accounts, clients } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { parseBody } from "@/lib/schemas/common";
import { allocationPutSchema } from "@/lib/schemas/allocations";

export const dynamic = "force-dynamic";

async function assertAccountInFirm(clientId: string, accountId: string, firmId: string) {
  const [acct] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .innerJoin(clients, eq(clients.id, accounts.clientId))
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.clientId, clientId),
        eq(clients.firmId, firmId)
      )
    );
  return acct ?? null;
}

// GET — return account's custom asset allocations joined with asset class names
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id, accountId } = await params;

    const acct = await assertAccountInFirm(id, accountId, firmId);
    if (!acct) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const rows = await db
      .select({
        assetClassId: accountAssetAllocations.assetClassId,
        assetClassName: assetClasses.name,
        weight: accountAssetAllocations.weight,
      })
      .from(accountAssetAllocations)
      .innerJoin(assetClasses, eq(accountAssetAllocations.assetClassId, assetClasses.id))
      .where(eq(accountAssetAllocations.accountId, accountId));

    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/accounts/[accountId]/allocations error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT — replace all allocations for this account (delete + insert)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id, accountId } = await params;

    const acct = await assertAccountInFirm(id, accountId, firmId);
    if (!acct) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const parsed = await parseBody(allocationPutSchema, req);
    if (!parsed.ok) return parsed.response;
    const { allocations } = parsed.data;

    const total = allocations.reduce((s, a) => s + a.weight, 0);
    if (total > 1.0001) {
      return NextResponse.json(
        { error: `Total weight ${total} exceeds 1.0` },
        { status: 400 }
      );
    }

    // Verify every referenced asset class belongs to this firm.
    const classIds = Array.from(new Set(allocations.map((a) => a.assetClassId)));
    if (classIds.length > 0) {
      const validClasses = await db
        .select({ id: assetClasses.id })
        .from(assetClasses)
        .where(eq(assetClasses.firmId, firmId));
      const validIds = new Set(validClasses.map((c) => c.id));
      for (const cid of classIds) {
        if (!validIds.has(cid)) {
          return NextResponse.json(
            { error: "Invalid asset class reference" },
            { status: 400 }
          );
        }
      }
    }

    // Filter out zero-weight entries — no point storing them
    const nonZero = allocations.filter((a) => a.weight > 0);

    await db.transaction(async (tx) => {
      await tx
        .delete(accountAssetAllocations)
        .where(eq(accountAssetAllocations.accountId, accountId));

      if (nonZero.length > 0) {
        await tx.insert(accountAssetAllocations).values(
          nonZero.map((a) => ({
            accountId,
            assetClassId: a.assetClassId,
            weight: String(a.weight),
          }))
        );
      }
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id]/accounts/[accountId]/allocations error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
