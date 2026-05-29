import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accountHoldings, accounts, clients, holdingAssetClassOverrides, securityAssetClassWeights } from "@/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { parseBody } from "@/lib/schemas/common";
import { holdingCreateSchema } from "@/lib/schemas/holdings";
import { recordAudit } from "@/lib/audit";
import { syncAccountFromHoldings } from "@/lib/investments/sync-account-from-holdings";

export const dynamic = "force-dynamic";

export type RawHoldingRow = typeof accountHoldings.$inferSelect;

export interface EnrichedHoldingRow extends RawHoldingRow {
  securityWeights: { slug: string; weight: number }[];
  overrides: { assetClassId: string; weight: number }[];
  needsReview: boolean;
}

/** Pure: attach each row's security slug-blend + override blend, and flag rows
 *  that nothing classifies (no security weights AND no overrides → would fall
 *  entirely to the inflation residual). Kept pure for unit testing. */
export function enrichHoldingRows(
  rows: readonly RawHoldingRow[],
  weightsBySecurity: ReadonlyMap<string, { slug: string; weight: number }[]>,
  overridesByHolding: ReadonlyMap<string, { assetClassId: string; weight: number }[]>,
): EnrichedHoldingRow[] {
  return rows.map((r) => {
    const securityWeights = r.securityId ? weightsBySecurity.get(r.securityId) ?? [] : [];
    const overrides = overridesByHolding.get(r.id) ?? [];
    return {
      ...r,
      securityWeights,
      overrides,
      needsReview: securityWeights.length === 0 && overrides.length === 0,
    };
  });
}

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

// GET — list all holdings for this account, ordered by sortOrder then createdAt
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
      .select()
      .from(accountHoldings)
      .where(eq(accountHoldings.accountId, accountId))
      .orderBy(asc(accountHoldings.sortOrder), asc(accountHoldings.createdAt));

    const holdingIds = rows.map((r) => r.id);
    const securityIds = Array.from(
      new Set(rows.map((r) => r.securityId).filter((s): s is string => s != null)),
    );
    const [overrideRows, weightRows] = await Promise.all([
      holdingIds.length
        ? db.select().from(holdingAssetClassOverrides)
            .where(inArray(holdingAssetClassOverrides.holdingId, holdingIds))
        : [],
      securityIds.length
        ? db.select().from(securityAssetClassWeights)
            .where(inArray(securityAssetClassWeights.securityId, securityIds))
        : [],
    ]);

    const weightsBySecurity = new Map<string, { slug: string; weight: number }[]>();
    for (const w of weightRows) {
      const list = weightsBySecurity.get(w.securityId) ?? [];
      list.push({ slug: w.assetClassSlug, weight: parseFloat(w.weight) });
      weightsBySecurity.set(w.securityId, list);
    }
    const overridesByHolding = new Map<string, { assetClassId: string; weight: number }[]>();
    for (const o of overrideRows) {
      const list = overridesByHolding.get(o.holdingId) ?? [];
      list.push({ assetClassId: o.assetClassId, weight: parseFloat(o.weight) });
      overridesByHolding.set(o.holdingId, list);
    }

    return NextResponse.json(enrichHoldingRows(rows, weightsBySecurity, overridesByHolding));
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/accounts/[accountId]/holdings error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST — create a single holding on this account
export async function POST(
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

    const parsed = await parseBody(holdingCreateSchema, req);
    if (!parsed.ok) return parsed.response;
    const b = parsed.data;

    const [row] = await db
      .insert(accountHoldings)
      .values({
        accountId,
        securityId: b.securityId ?? null,
        displayTicker: b.displayTicker ?? null,
        displayName: b.displayName ?? null,
        shares: String(b.shares),
        price: String(b.price),
        priceAsOf: b.priceAsOf ?? null,
        costBasis: String(b.costBasis),
        sortOrder: b.sortOrder ?? 0,
        notes: b.notes ?? null,
      })
      .returning();

    await recordAudit({
      action: "account.holding.create",
      resourceType: "account",
      resourceId: accountId,
      clientId: id,
      firmId,
      metadata: { holdingId: row.id, ticker: b.displayTicker ?? null },
    });

    await syncAccountFromHoldings(accountId);

    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/accounts/[accountId]/holdings error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
