import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accountAssetAllocations, assetClasses } from "@/db/schema";
import { eq, and } from "drizzle-orm";

// GET — return account's custom asset allocations joined with asset class names
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> }
) {
  const { accountId } = await params;

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
}

// PUT — replace all allocations for this account (delete + insert)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> }
) {
  const { accountId } = await params;
  const body = await req.json();
  const allocations: { assetClassId: string; weight: number }[] = body.allocations ?? [];

  // Validate: no negative weights, no weight > 1, total <= 1
  let total = 0;
  for (const a of allocations) {
    if (a.weight < 0 || a.weight > 1) {
      return NextResponse.json(
        { error: `Weight must be between 0 and 1, got ${a.weight}` },
        { status: 400 }
      );
    }
    total += a.weight;
  }
  if (total > 1.0001) {
    return NextResponse.json(
      { error: `Total weight ${total} exceeds 1.0` },
      { status: 400 }
    );
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
}
